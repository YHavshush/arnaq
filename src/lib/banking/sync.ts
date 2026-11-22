import "server-only";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { bankName } from "@/lib/import/banks";
import { ImportError, MAX_IMPORT_ROWS, importRows } from "@/lib/import/service";
import type { ParsedRow, SkippedRow } from "@/lib/import/types";
import { addDays, isDate } from "@/lib/recurring/dates";
import { clearSample } from "@/lib/sample/sample";
import { instantMs, type RunAsUser } from "./connections";
import { applyReportedBalance, convertTransactions } from "./convert";
import {
  EnableBankingError,
  getBalances,
  getTransactions,
  isSessionOver,
  type Balance,
  type BankingConfig,
  type BankingEnvironment,
  type PsuHeaders,
} from "./enable-banking";
import type { SyncLinkReport } from "./types";

/** A first sync reaches this far back; later ones start a week before the last one, so late bookings are caught. */
export const FIRST_SYNC_DAYS = 30;

/**
 * The period a sync may claim to cover completely: from the earliest booked transaction the bank sent (but not before
 * the date asked for) to today. Null when the bank sent nothing: then no month is claimed.
 */
export function coveredPeriod(
  rows: ParsedRow[],
  askedFrom: string,
  today: string,
): { from: string; to: string } | null {
  if (rows.length === 0) return null;
  const earliest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
  const from = earliest > askedFrom ? earliest : askedFrom;
  return from <= today ? { from, to: today } : null;
}
export const OVERLAP_DAYS = 7;
/** Pages of transactions read per account per refresh, at most. A bank that sends more is reported, not followed. */
export const MAX_PAGES = 50;
/** A whole refresh stops asking the banks after this long; what was fetched by then is saved. */
export const SYNC_DEADLINE_MS = 45_000;
/** Bytes of answers one account may take per refresh (more is refused), and a whole refresh (more stops it early). */
export const LINK_BYTE_BUDGET = 10 * 1024 * 1024;
export const RUN_BYTE_BUDGET = 20 * 1024 * 1024;

export const STOPPED_EARLY = "Stopped early to keep the refresh quick. Refresh again for the rest.";
const OTHER_APPLICATION =
  "This bank link was made with another Enable Banking application. Link the bank again.";

/** The refresh ran out of time or bytes: this account and the ones after it wait for the next refresh. */
class StopEarly extends Error {}

const messageOf = (e: unknown): string => {
  if (e instanceof ImportError) return e.message;
  if (e instanceof EnableBankingError) {
    if (e.code === "ASPSP_RATE_LIMIT_EXCEEDED" || e.status === 429)
      return "The bank is busy. Try again later.";
    if (e.code === "TOO_MANY_PAGES")
      return "The bank sent more transactions than arnaq reads at once.";
    return "Enable Banking could not be reached. Try again later.";
  }
  return "The transactions could not be saved.";
};

/**
 * "Refresh now": for every active bank link, read the booked transactions since the last refresh (a week of overlap; 90
 * days the first time) and the bank's balances, and put them through the same importer as an uploaded file, so sorting,
 * transfers between own accounts, rows already uploaded from a file, fixed costs and the import log all behave the
 * same. The bank is asked without holding the database; each page becomes rows at once (the raw answer is dropped),
 * and each account is stored in a short transaction of its own as soon as it has been read, so an account that fails
 * stores nothing and the ones before it are kept. The whole refresh has a deadline and a byte budget: past either, the
 * remaining accounts are reported as stopped early. A consent that is over marks its connection expired. Reports per
 * linked account.
 */
export async function syncBankLinks(
  config: BankingConfig,
  run: RunAsUser,
  opts: {
    today: string;
    /** The kind of application this server uses: links made with another kind are not read with it. */
    environment: BankingEnvironment;
    /**
     * Who is asking, always said out loud. "pressed-refresh": the signed-in person pressed the button, and the PSU
     * headers from their request (psuHeadersFromRequest) tell the bank they are there. "background": nobody is there, and
     * no PSU headers can be sent (a future scheduled sync must say this; there is no default to fall into).
     */
    presence: { by: "pressed-refresh"; psu: PsuHeaders | null } | { by: "background" };
    now?: number;
    /** The clock for the deadline (tests pass a fake one). */
    clock?: () => number;
    /** Smaller limits than the defaults (tests). */
    limits?: { deadlineMs?: number; linkBytes?: number; runBytes?: number };
  },
): Promise<SyncLinkReport[]> {
  const { today } = opts;
  const clock = opts.clock ?? Date.now;
  const now = opts.now ?? clock();
  const deadline = clock() + (opts.limits?.deadlineMs ?? SYNC_DEADLINE_MS);
  const linkBudget = opts.limits?.linkBytes ?? LINK_BYTE_BUDGET;
  const runBudget = opts.limits?.runBytes ?? RUN_BYTE_BUDGET;
  if (!isDate(today)) throw new Error("Invalid date.");
  const psu = opts.presence.by === "pressed-refresh" ? opts.presence.psu : null;
  const links = await run((db) =>
    db
      .select({
        id: schema.bankLinks.id,
        connectionId: schema.bankLinks.connectionId,
        accountUid: schema.bankLinks.accountUid,
        accountId: schema.bankLinks.accountId,
        lastSyncedAt: schema.bankLinks.lastSyncedAt,
        sessionId: schema.bankConnections.sessionId,
        validUntil: schema.bankConnections.validUntil,
        environment: schema.bankConnections.environment,
        accountName: schema.accounts.name,
        bank: schema.accounts.bank,
      })
      .from(schema.bankLinks)
      .innerJoin(
        schema.bankConnections,
        eq(schema.bankConnections.id, schema.bankLinks.connectionId),
      )
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.bankLinks.accountId))
      .where(eq(schema.bankConnections.status, "active"))
      .orderBy(schema.bankLinks.id),
  );

  const reports: SyncLinkReport[] = [];
  const expired = new Set<number>();
  const markExpired = async (connectionId: number) => {
    if (expired.has(connectionId)) return;
    expired.add(connectionId);
    await run((db) =>
      db
        .update(schema.bankConnections)
        .set({ status: "expired" })
        .where(
          and(
            eq(schema.bankConnections.id, connectionId),
            eq(schema.bankConnections.status, "active"),
          ),
        ),
    );
  };
  let runBytes = 0;
  let stopped = false;
  let sampleCleared = false;

  for (const link of links) {
    const report: SyncLinkReport = {
      linkId: link.id,
      accountName: link.accountName,
      status: "ok",
      imported: 0,
      duplicate: 0,
    };
    reports.push(report);
    if (stopped) {
      report.status = "stopped";
      report.error = STOPPED_EARLY;
      continue;
    }
    if (link.environment !== opts.environment) {
      report.status = "failed";
      report.error = OTHER_APPLICATION;
      continue;
    }
    const until = instantMs(link.validUntil);
    if (expired.has(link.connectionId) || (until !== null && until <= now) || !link.sessionId) {
      await markExpired(link.connectionId);
      report.status = "expired";
      continue;
    }
    const lastDay = instantMs(link.lastSyncedAt);
    const fromRaw =
      lastDay === null
        ? addDays(today, -FIRST_SYNC_DAYS)
        : addDays(new Date(lastDay).toISOString().slice(0, 10), -OVERLAP_DAYS);
    const from = fromRaw > today ? today : fromRaw;
    // Banks book a little before or after the dates asked for; a month either side is believed, nothing beyond.
    const range = { from: addDays(from, -31), to: addDays(today, 7) };
    try {
      const rows: ParsedRow[] = [];
      const skipped: SkippedRow[] = [];
      const seen = new Set<string>();
      let key: string | null = null;
      let linkBytes = 0;
      let position = 0;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new EnableBankingError(502, "TOO_MANY_PAGES");
        const left = deadline - clock();
        if (left <= 0) throw new StopEarly();
        const result = await getTransactions(config, link.accountUid, {
          dateFrom: from,
          dateTo: today,
          continuationKey: key,
          timeoutMs: left,
          psu,
        });
        linkBytes += result.bytes;
        runBytes += result.bytes;
        if (linkBytes > linkBudget) throw new EnableBankingError(502, "TOO_MANY_PAGES");
        if (runBytes > runBudget) throw new StopEarly();
        // Rows right away; the raw page is not kept.
        const converted = convertTransactions(result.transactions, range);
        rows.push(...converted.rows);
        for (const s of converted.skipped) skipped.push({ ...s, line: s.line + position });
        position += result.transactions.length;
        if (rows.length + skipped.length > MAX_IMPORT_ROWS)
          throw new EnableBankingError(502, "TOO_MANY_PAGES");
        // An empty page can still carry a key: keep going. The same key twice would loop forever: stop.
        if (!result.continuationKey || seen.has(result.continuationKey)) break;
        seen.add(result.continuationKey);
        key = result.continuationKey;
      }
      let balances: Balance[] = [];
      const left = deadline - clock();
      if (left > 0)
        try {
          balances = await getBalances(config, link.accountUid, left, psu);
        } catch (e) {
          if (isSessionOver(e)) throw e;
          // A balance is a bonus: the transactions still count without it. Only the answer's status and code are
          // logged (never an account id or amount), so a bank that gives no balance can be told from one that fails.
          console.warn(
            `Bank balance not fetched (${e instanceof EnableBankingError ? `${e.status} ${e.code ?? ""}`.trim() : "error"}).`,
          );
        }
      if (balances.length === 0) console.warn("The bank reported no balances for an account.");
      applyReportedBalance(rows, balances);

      // Stored now, in a transaction of its own: what was read is kept even if a later account is slow or fails.
      const label = link.environment === "SANDBOX" ? "Enable Banking sandbox" : "Enable Banking";
      // Which months the bank covers: only from the earliest transaction it actually sent (never from the date asked
      // for: a bank may give less history than asked), up to today. Months before that stay open.
      const coverage = coveredPeriod(rows, from, today);
      const summary = await run(async (db) => {
        const [still] = await db
          .select({ id: schema.bankLinks.id })
          .from(schema.bankLinks)
          .where(eq(schema.bankLinks.id, link.id));
        if (!still) throw new ImportError("This bank link was removed.");
        // Nothing sent: nothing to import, and nothing can be said about which months are complete.
        const result =
          rows.length === 0
            ? null
            : await (async () => {
                // Real data and sample data never mix: the first real rows replace the sample, like an upload does.
                if (!sampleCleared) await clearSample(db, today);
                return await importRows(db, {
                  bank: link.bank,
                  accountId: link.accountId,
                  parsed: { rows, skipped, accountIdentifier: null },
                  period: coverage ?? undefined,
                  filename: `${bankName(link.bank)} (${label})`,
                  today,
                });
              })();
        await db
          .update(schema.bankLinks)
          .set({ lastSyncedAt: new Date(now).toISOString() })
          .where(eq(schema.bankLinks.id, link.id));
        return result;
      });
      if (rows.length > 0) sampleCleared = true;
      report.imported = summary?.rowsImported ?? 0;
      report.duplicate = summary?.rowsDuplicate ?? 0;
    } catch (e) {
      const outOfTime =
        e instanceof EnableBankingError && e.code === "TIMEOUT" && clock() >= deadline;
      if (e instanceof StopEarly || outOfTime) {
        stopped = true;
        report.status = "stopped";
        report.error = STOPPED_EARLY;
      } else if (isSessionOver(e)) {
        await markExpired(link.connectionId);
        report.status = "expired";
      } else {
        report.status = "failed";
        report.error = messageOf(e);
      }
    }
  }
  return reports;
}
