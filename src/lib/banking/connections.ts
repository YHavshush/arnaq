import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { bankName } from "@/lib/import/banks";
import type { Bank } from "@/lib/import/types";
import { clearSample } from "@/lib/sample/sample";
import { aspspBank } from "./banks";
import { BankingError } from "./errors";
import {
  EnableBankingError,
  createSession,
  deleteSession,
  getAspsps,
  maskIban,
  startAuthorization,
  type BankingConfig,
  type BankingEnvironment,
  type Session,
} from "./enable-banking";
import type { AspspOption, BankConnectionView, CallbackResult, ConnectionStatus } from "./types";

/** Runs a function as the signed-in person, in one transaction (userDb in the app, asTestUser in tests). */
export type RunAsUser = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

export { BankingError };

/** How long the person has at the bank before the one-time state stops working. */
export const STATE_TTL_MS = 15 * 60_000;
/** PSD2 consents last at most 180 days; a bank may allow less. */
export const MAX_CONSENT_SECONDS = 180 * 86_400;
/** Connections a person can have at once (pending and closed ones do not count). */
export const MAX_CONNECTIONS = 10;
const DAY_MS = 86_400_000;

export const hashState = (state: string): string =>
  createHash("sha256").update(state, "utf8").digest("hex");
const newState = (): string => randomBytes(32).toString("base64url");
/** What newState makes: 32 random bytes, base64url, 43 characters. Anything else is not ours. */
export const isWellFormedState = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);

/** An account number as stored, compared loosely (an uploaded file may have spaces or lower case). */
const looseIban = (v: string | null): string | null =>
  v === null ? null : v.replace(/\s+/g, "").toUpperCase();

/** A timestamptz as Postgres hands it over ("2026-11-18 10:00:00+00") in milliseconds, or null. */
export function instantMs(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isFinite(t) ? t : null;
}

/** The banks a person can link in a country: personal accounts only, and only banks arnaq knows. */
export async function linkableAspsps(
  config: BankingConfig,
  country: string,
): Promise<AspspOption[]> {
  const list = await getAspsps(config, country);
  const out: AspspOption[] = [];
  for (const a of list) {
    const bank = aspspBank(a.name);
    if (!bank || !a.psuTypes.includes("personal")) continue;
    out.push({
      name: a.name,
      country: a.country,
      logo: a.logo,
      maximumConsentValidity: a.maximumConsentValidity,
      bank,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

function friendly(e: unknown): never {
  if (e instanceof EnableBankingError) {
    if (e.code === "NO_ACCOUNTS_ADDED")
      throw new BankingError(
        "No bank accounts are linked to the Enable Banking application yet. Link them in the Enable Banking control panel first.",
      );
    if (e.code === "REDIRECT_URI_NOT_ALLOWED")
      throw new BankingError(
        "The return address is not registered with Enable Banking. Add it in the Enable Banking control panel.",
      );
    if (e.code === "ASPSP_RATE_LIMIT_EXCEEDED" || e.status === 429)
      throw new BankingError("The bank is busy. Try again later.");
  }
  throw new BankingError("Enable Banking could not be reached. Try again later.");
}

/**
 * Start linking a bank: a pending connection with a fresh random state (only its hash is stored), then Enable Banking's
 * address at the bank for the browser to open. The consent asked for is the bank's longest, at most 180 days.
 */
export async function beginConnect(
  config: BankingConfig,
  run: RunAsUser,
  input: {
    aspsp: { name: string; country: string };
    language: "en" | "nl";
    appUrl: URL;
    /** The kind of application this server uses (from bankingStatus): recorded on the connection. */
    environment: BankingEnvironment;
    now?: number;
  },
): Promise<{ url: string }> {
  const now = input.now ?? Date.now();
  let options: AspspOption[];
  try {
    options = await linkableAspsps(config, input.aspsp.country);
  } catch (e) {
    friendly(e);
  }
  const aspsp = options.find((a) => a.name === input.aspsp.name);
  if (!aspsp) throw new BankingError("This bank cannot be linked.");

  const state = newState();
  const id = await run(async (db) => {
    // Tidy up first: unfinished links past their time, and failed or closed ones older than a month.
    await db
      .delete(schema.bankConnections)
      .where(
        or(
          and(
            eq(schema.bankConnections.status, "pending"),
            lt(schema.bankConnections.createdAt, new Date(now - STATE_TTL_MS).toISOString()),
          ),
          and(
            inArray(schema.bankConnections.status, ["failed", "closed"]),
            lt(schema.bankConnections.createdAt, new Date(now - 30 * DAY_MS).toISOString()),
          ),
        ),
      );
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.bankConnections)
      .where(inArray(schema.bankConnections.status, ["pending", "active", "expired"]));
    if (n >= MAX_CONNECTIONS)
      throw new BankingError(`At most ${MAX_CONNECTIONS} bank connections at a time.`);
    const [row] = await db
      .insert(schema.bankConnections)
      .values({
        aspspName: aspsp.name,
        aspspCountry: aspsp.country,
        environment: input.environment,
        status: "pending",
        stateHash: hashState(state),
        createdAt: new Date(now).toISOString(),
      })
      .returning({ id: schema.bankConnections.id });
    return row.id;
  });

  const seconds = Math.min(MAX_CONSENT_SECONDS, aspsp.maximumConsentValidity);
  // A minute short of the limit, so a bank that counts from its own clock does not refuse it.
  const validUntil = new Date(now + Math.max(seconds - 60, 60) * 1000).toISOString();
  try {
    return await startAuthorization(config, {
      validUntil,
      aspsp: { name: aspsp.name, country: aspsp.country },
      state,
      redirectUrl: new URL("/api/banking/callback", input.appUrl).toString(),
      language: input.language,
    });
  } catch (e) {
    await run((db) =>
      db
        .update(schema.bankConnections)
        .set({ status: "failed", stateHash: null })
        .where(eq(schema.bankConnections.id, id)),
    );
    friendly(e);
  }
}

/** Accounts a session brought in: reuse the person's own arnaq account when it is clearly the same one. */
async function accountFor(
  db: Db,
  bank: Bank,
  account: Session["accounts"][number],
  taken: Set<number>,
): Promise<number> {
  const all = await db.select().from(schema.accounts);
  const byIban = account.iban
    ? all.find((a) => looseIban(a.iban) === account.iban && !taken.has(a.id))
    : undefined;
  if (byIban) return byIban.id;
  const ibanFree = account.iban !== null && !all.some((a) => looseIban(a.iban) === account.iban);
  // A Revolut export names no account, so an uploaded Revolut account has no IBAN: when there is exactly one, it is
  // this one (otherwise the bank's rows would land next to the uploaded ones, twice). Other banks' files name the IBAN.
  if (bank === "revolut") {
    const open = all.filter((a) => a.bank === bank && a.iban === null && !taken.has(a.id));
    if (open.length === 1) {
      if (ibanFree)
        await db
          .update(schema.accounts)
          .set({ iban: account.iban })
          .where(eq(schema.accounts.id, open[0].id));
      return open[0].id;
    }
  }
  // The name shows only the last four characters of the account number ("Rabobank ••1234"); the full IBAN is kept
  // where accounts keep it, for matching.
  const [created] = await db
    .insert(schema.accounts)
    .values({
      name: account.iban ? `${bankName(bank)} ${maskIban(account.iban)}` : bankName(bank),
      bank,
      iban: ibanFree ? account.iban : null,
      currency: account.currency,
    })
    .returning({ id: schema.accounts.id });
  return created.id;
}

/**
 * The person is back from the bank. The state must be one this person started (row level security: another person's
 * state finds nothing), still pending and less than 15 minutes old; it is used up at once, before anything else, so it
 * works one time only. Then the code becomes a session, the accounts are linked to arnaq accounts, and an older
 * connection to the same bank (a reconnect) is closed. Returns the short result Settings shows.
 */
export async function completeCallback(
  config: BankingConfig,
  run: RunAsUser,
  params: { state: string | null; code: string | null; error: string | null },
  now: number = Date.now(),
): Promise<CallbackResult> {
  const { state, code, error } = params;
  // A state arnaq could not have made is not even looked up.
  if (!isWellFormedState(state)) return "expired";
  const consumed = await run(async (db) => {
    const [row] = await db
      .update(schema.bankConnections)
      .set({ stateHash: null })
      .where(
        and(
          eq(schema.bankConnections.stateHash, hashState(state)),
          eq(schema.bankConnections.status, "pending"),
        ),
      )
      .returning();
    if (!row) return null;
    const fresh = await db
      .select({ id: schema.bankConnections.id })
      .from(schema.bankConnections)
      .where(
        and(
          eq(schema.bankConnections.id, row.id),
          gt(schema.bankConnections.createdAt, new Date(now - STATE_TTL_MS).toISOString()),
        ),
      );
    if (fresh.length === 0 || error || !code) {
      await db
        .update(schema.bankConnections)
        .set({ status: "failed" })
        .where(eq(schema.bankConnections.id, row.id));
      return { row, ok: false as const, expired: fresh.length === 0 };
    }
    return { row, ok: true as const, expired: false };
  });
  if (!consumed) return "expired";
  if (consumed.expired) return "expired";
  if (!consumed.ok)
    return error === "access_denied" || error === "cancelled" ? "cancelled" : "failed";
  const connection = consumed.row;
  const bank = aspspBank(connection.aspspName);
  const markFailed = () =>
    run((db) =>
      db
        .update(schema.bankConnections)
        .set({ status: "failed" })
        .where(eq(schema.bankConnections.id, connection.id)),
    );
  if (!bank || !code || code.length > 2000) {
    await markFailed();
    return "failed";
  }

  let session: Session;
  try {
    session = await createSession(config, code);
  } catch (e) {
    await markFailed();
    return e instanceof EnableBankingError && e.code === "NO_ACCOUNTS_ADDED"
      ? "noaccounts"
      : "failed";
  }
  if (session.accounts.length === 0) {
    await markFailed();
    await deleteSession(config, session.sessionId).catch(() => undefined);
    return "noaccounts";
  }

  let superseded: string[];
  try {
    superseded = await run(async (db) => {
      // Real data and sample data never mix: linking a bank replaces the sample, like the first upload does.
      await clearSample(db, new Date(now).toISOString().slice(0, 10));
      // A reconnect: the older connections to this bank make way for the new one.
      const older = await db
        .select()
        .from(schema.bankConnections)
        .where(
          and(
            ne(schema.bankConnections.id, connection.id),
            eq(schema.bankConnections.aspspName, connection.aspspName),
            eq(schema.bankConnections.aspspCountry, connection.aspspCountry),
            inArray(schema.bankConnections.status, ["active", "expired"]),
          ),
        );
      const olderIds = older.map((c) => c.id);
      const olderLinks =
        olderIds.length === 0
          ? []
          : await db
              .select()
              .from(schema.bankLinks)
              .where(inArray(schema.bankLinks.connectionId, olderIds));
      // Accounts another bank link already fills are not reused.
      const otherLinks = await db
        .select({ accountId: schema.bankLinks.accountId })
        .from(schema.bankLinks)
        .where(notInArray(schema.bankLinks.connectionId, [connection.id, ...olderIds]));
      const taken = new Set(otherLinks.map((l) => l.accountId));
      for (const account of session.accounts) {
        const accountId = await accountFor(db, bank, account, taken);
        taken.add(accountId);
        // Keep counting on from where the older link stopped, so a reconnect does not fetch everything again.
        const previous = olderLinks
          .filter((l) => l.accountId === accountId && l.lastSyncedAt)
          .map((l) => l.lastSyncedAt!)
          .sort()
          .at(-1);
        await db.insert(schema.bankLinks).values({
          connectionId: connection.id,
          accountUid: account.uid,
          currency: account.currency,
          accountId,
          lastSyncedAt: previous ?? null,
        });
      }
      if (olderIds.length > 0) {
        await db.delete(schema.bankLinks).where(inArray(schema.bankLinks.connectionId, olderIds));
        await db
          .update(schema.bankConnections)
          .set({ status: "closed", sessionId: null, stateHash: null })
          .where(inArray(schema.bankConnections.id, olderIds));
      }
      // The consent's end as the bank gave it, but never later than PSD2 allows (180 days from now); without one, that.
      const latest = now + MAX_CONSENT_SECONDS * 1000;
      const given = session.validUntil ? Date.parse(session.validUntil) : latest;
      const validUntil = new Date(Math.min(given, latest)).toISOString();
      await db
        .update(schema.bankConnections)
        .set({ status: "active", sessionId: session.sessionId, validUntil })
        .where(eq(schema.bankConnections.id, connection.id));
      return older.map((c) => c.sessionId).filter((s): s is string => s !== null);
    });
  } catch {
    // Nothing was stored: end the session again rather than leave a consent nobody can see. (Only that it happened is
    // logged: no ids, no account numbers.)
    console.warn("Enable Banking: a linked session could not be stored and was ended again.");
    await deleteSession(config, session.sessionId).catch(() => undefined);
    await markFailed().catch(() => undefined);
    return "failed";
  }
  await revokeSessions(config, superseded);
  return "linked";
}

/**
 * End sessions at Enable Banking, as well as possible: one that cannot be reached runs out on its own. Without a
 * configuration nothing can be called; only how many were skipped is logged (never an id).
 */
export async function revokeSessions(
  config: BankingConfig | null,
  sessionIds: string[],
): Promise<void> {
  if (!config) {
    if (sessionIds.length > 0)
      console.warn(
        `Enable Banking is not configured: ${sessionIds.length} bank session(s) were not ended remotely; they run out by themselves.`,
      );
    return;
  }
  for (const id of sessionIds) await deleteSession(config, id).catch(() => undefined);
}

/** Every session the person holds (for erasing all their data, or a restore). */
export async function sessionIdsOf(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: schema.bankConnections.sessionId })
    .from(schema.bankConnections)
    .where(isNotNull(schema.bankConnections.sessionId));
  return rows.map((r) => r.id!);
}

export class ConnectionNotFound extends Error {}

/**
 * Disconnect: end the consent at Enable Banking (one that is already gone is fine), then mark the connection closed and
 * remove its links. The transactions it brought in stay. Without a configuration (the feature switched off) the
 * connection is closed here only and `revoked` is false: the consent then runs out at the bank by itself. Throws
 * ConnectionNotFound for a connection the person does not have (another person's included).
 */
export async function disconnect(
  config: BankingConfig | null,
  run: RunAsUser,
  id: number,
): Promise<{ revoked: boolean }> {
  const row = await run(async (db) =>
    (
      await db
        .select({ sessionId: schema.bankConnections.sessionId })
        .from(schema.bankConnections)
        .where(and(eq(schema.bankConnections.id, id), ne(schema.bankConnections.status, "closed")))
    ).at(0),
  );
  if (!row) throw new ConnectionNotFound();
  if (row.sessionId && config) {
    try {
      await deleteSession(config, row.sessionId);
    } catch {
      throw new BankingError("Enable Banking could not be reached. Try again later.");
    }
  }
  await run(async (db) => {
    await db.delete(schema.bankLinks).where(eq(schema.bankLinks.connectionId, id));
    await db
      .update(schema.bankConnections)
      .set({ status: "closed", sessionId: null, stateHash: null })
      .where(eq(schema.bankConnections.id, id));
  });
  return { revoked: row.sessionId === null || config !== null };
}

/**
 * The connections for Settings: no session id, state or token. The linked accounts show by their arnaq name, as on the
 * rest of the screens; an account an uploaded file created can carry its account number in that name.
 */
export async function listConnections(
  db: Db,
  now: number = Date.now(),
): Promise<BankConnectionView[]> {
  const connections = await db
    .select({
      id: schema.bankConnections.id,
      aspspName: schema.bankConnections.aspspName,
      status: schema.bankConnections.status,
      validUntil: schema.bankConnections.validUntil,
    })
    .from(schema.bankConnections)
    .where(inArray(schema.bankConnections.status, ["active", "expired"]))
    .orderBy(schema.bankConnections.aspspName, schema.bankConnections.id);
  if (connections.length === 0) return [];
  const links = await db
    .select({
      id: schema.bankLinks.id,
      connectionId: schema.bankLinks.connectionId,
      accountName: schema.accounts.name,
      lastSyncedAt: schema.bankLinks.lastSyncedAt,
    })
    .from(schema.bankLinks)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.bankLinks.accountId))
    .orderBy(schema.accounts.name, schema.bankLinks.id);
  return connections.map((c) => {
    const until = instantMs(c.validUntil);
    const over = c.status === "expired" || (until !== null && until <= now);
    return {
      id: c.id,
      bankName: c.aspspName,
      bank: aspspBank(c.aspspName),
      status: (over ? "expired" : c.status) as ConnectionStatus,
      daysLeft: until === null ? null : Math.max(0, Math.floor((until - now) / DAY_MS)),
      links: links
        .filter((l) => l.connectionId === c.id)
        .map((l) => ({
          id: l.id,
          accountName: l.accountName,
          lastSyncedAt:
            instantMs(l.lastSyncedAt) === null
              ? null
              : new Date(instantMs(l.lastSyncedAt)!).toISOString(),
        })),
    };
  });
}
