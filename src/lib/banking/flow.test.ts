import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER_A, TEST_USER_B, createDb, schema, type Db } from "@/db";
import { withUser } from "@/db/scoped";
import { deleteAllMyData } from "@/lib/account";
import { buildExport } from "@/lib/export";
import { importStatement } from "@/lib/import/service";
import {
  BankingError,
  ConnectionNotFound,
  STATE_TTL_MS,
  beginConnect,
  completeCallback,
  disconnect,
  hashState,
  listConnections,
  revokeSessions,
  sessionIdsOf,
  type RunAsUser,
} from "./connections";
import { coveredMonths } from "@/lib/recurring/occurrences";
import { bankingConfig, psuHeadersFromRequest } from "./enable-banking";
import { coveredPeriod, syncBankLinks } from "./sync";
import {
  SESSION_ID,
  TEST_APP_URL,
  aspspList,
  disableBanking,
  enableBanking,
  mockEnableBanking,
  sessionAnswer,
  stateOf,
  type Call,
} from "../../../tests/helpers/enable-banking";

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const TODAY = "2026-11-18";
/** A sync nobody pressed a button for: no PSU headers. */
const BG = { by: "background" } as const;
const AUTH_URL = "https://auth.eb.test/ais/start?sessionid=x";
const IBAN = "NL03RABO0000000001"; // the account of rabobankCsv() below
const IBAN_2 = "NL73RABO0000000002";
/** tests/fixtures/rabobank-sample.csv with an IBAN whose check digits are right (the fixture's own has none). */
const rabobankCsv = () =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/rabobank-sample.csv"), "utf8").replaceAll(
    "NL00RABO0000000001",
    IBAN,
  );

let root: Db;
let asA: RunAsUser;
let asB: RunAsUser;
const config = () => bankingConfig()!;

beforeEach(async () => {
  enableBanking();
  root = await createDb(":memory:", { user: null });
  asA = (fn) => withUser(root, TEST_USER_A, fn);
  asB = (fn) => withUser(root, TEST_USER_B, fn);
});
afterEach(() => {
  vi.unstubAllGlobals();
  disableBanking();
});

const baseRoutes = (
  over: [string | RegExp, Parameters<typeof mockEnableBanking>[0][number][1]][] = [],
) =>
  mockEnableBanking([
    ...over,
    ["GET /aspsps", { body: aspspList }],
    ["POST /auth", { body: { url: AUTH_URL, authorization_id: "auth-1" } }],
    ["POST /sessions", { body: sessionAnswer([{ uid: "acc-1", iban: IBAN }]) }],
    [/^DELETE \/sessions\//, { body: { message: "OK" } }],
    [/^GET \/accounts\/[^/]+\/balances$/, { body: { balances: [] } }],
    [/^GET \/accounts\/[^/]+\/transactions$/, { body: { transactions: [] } }],
  ]);

const connect = (run: RunAsUser = asA, now = NOW, name = "Rabobank") =>
  beginConnect(config(), run, {
    aspsp: { name, country: "NL" },
    language: "en",
    appUrl: new URL(TEST_APP_URL),
    environment: "PRODUCTION",
    now,
  });

/** Link Rabobank for A and come back from the bank. */
async function linkRabobank(calls: Call[]) {
  await connect();
  return await completeCallback(
    config(),
    asA,
    { state: stateOf(calls), code: "code-1", error: null },
    NOW + 60_000,
  );
}

const connections = (run: RunAsUser) => run((db) => db.select().from(schema.bankConnections));
const links = (run: RunAsUser) => run((db) => db.select().from(schema.bankLinks));

describe("connect", () => {
  it("stores a pending connection with only the hash of a fresh random state, and returns the bank's address", async () => {
    const calls = baseRoutes();
    expect(await connect()).toEqual({ url: AUTH_URL });
    const auth = calls.find((c) => c.url.pathname === "/auth")!;
    const body = auth.body as {
      state: string;
      access: { valid_until: string };
      redirect_url: string;
      psu_type: string;
    };
    expect(body.state).toMatch(/^[\w-]{43}$/);
    expect(body.redirect_url).toBe("https://arnaq.test/api/banking/callback");
    expect(body.psu_type).toBe("personal");
    // The consent asked for: the bank's maximum (180 days here), a minute short.
    expect(Date.parse(body.access.valid_until) - NOW).toBe((15552000 - 60) * 1000);
    const [row] = await connections(asA);
    expect(row).toMatchObject({ status: "pending", sessionId: null, aspspName: "Rabobank" });
    expect(row.stateHash).toBe(hashState(body.state));
    expect(JSON.stringify(row)).not.toContain(body.state);
    // A second connect makes another, different state.
    await connect();
    expect(stateOf(calls)).not.toBe(body.state);
  });

  it("asks a bank with a shorter maximum for that", async () => {
    const calls = baseRoutes();
    await connect(asA, NOW, "Revolut");
    const auth = calls.find((c) => c.url.pathname === "/auth")!.body as {
      access: { valid_until: string };
    };
    expect(Date.parse(auth.access.valid_until) - NOW).toBe((7776000 - 60) * 1000);
  });

  it("refuses a bank arnaq does not know, a business-only bank, and an unknown name", async () => {
    baseRoutes();
    for (const name of ["Voorbeeldbank", "Rabobank Zakelijk", "Nope"])
      await expect(connect(asA, NOW, name), name).rejects.toThrow("This bank cannot be linked.");
    expect(await connections(asA)).toEqual([]);
  });

  it("says plainly when the application has no linked accounts (restricted mode), and leaves nothing pending", async () => {
    baseRoutes([["POST /auth", { status: 422, body: { error: "NO_ACCOUNTS_ADDED" } }]]);
    await expect(connect()).rejects.toThrow(/Link them in the Enable Banking control panel/);
    const [row] = await connections(asA);
    expect(row).toMatchObject({ status: "failed", stateHash: null });
  });
});

describe("callback", () => {
  it("happy path: makes a session, links the account found by IBAN and keeps the consent's end", async () => {
    const calls = baseRoutes();
    await asA((db) =>
      importStatement(db, {
        content: rabobankCsv(),
        filename: "rabo.csv",
      }),
    );
    expect(await linkRabobank(calls)).toBe("linked");
    expect(calls.find((c) => c.url.pathname === "/sessions")!.body).toEqual({ code: "code-1" });
    const [c] = await connections(asA);
    expect(c).toMatchObject({ status: "active", sessionId: SESSION_ID, stateHash: null });
    expect(c.validUntil).toMatch(/^2027-05-17/);
    const accounts = await asA((db) => db.select().from(schema.accounts));
    expect(accounts).toHaveLength(1); // the uploaded account, not a new one
    const [l] = await links(asA);
    expect(l).toMatchObject({
      accountId: accounts[0].id,
      accountUid: "acc-1",
      currency: "EUR",
    });
    expect(c.environment).toBe("PRODUCTION");
    const view = await asA((db) => listConnections(db, NOW));
    expect(view).toEqual([
      {
        id: c.id,
        bankName: "Rabobank",
        bank: "rabobank",
        status: "active",
        daysLeft: 179,
        links: [{ id: l.id, accountName: accounts[0].name, lastSyncedAt: null }],
      },
    ]);
    expect(JSON.stringify(view)).not.toContain(SESSION_ID);
  });

  it("creates an account named after the bank when there is none", async () => {
    const calls = baseRoutes([["POST /sessions", { body: sessionAnswer([{ uid: "r-1" }]) }]]);
    await connect(asA, NOW, "Revolut");
    expect(
      await completeCallback(config(), asA, { state: stateOf(calls), code: "c", error: null }, NOW),
    ).toBe("linked");
    const accounts = await asA((db) => db.select().from(schema.accounts));
    expect(accounts.map((a) => [a.name, a.bank, a.iban])).toEqual([["Revolut", "revolut", null]]);
  });

  it("a state works once: the replay is refused and makes no second session", async () => {
    const calls = baseRoutes();
    expect(await linkRabobank(calls)).toBe("linked");
    const again = await completeCallback(
      config(),
      asA,
      { state: stateOf(calls), code: "code-1", error: null },
      NOW + 61_000,
    );
    expect(again).toBe("expired");
    expect(calls.filter((c) => c.url.pathname === "/sessions")).toHaveLength(1);
    expect(await links(asA)).toHaveLength(1);
  });

  it("a state older than 15 minutes is refused", async () => {
    const calls = baseRoutes();
    await connect();
    const result = await completeCallback(
      config(),
      asA,
      { state: stateOf(calls), code: "c", error: null },
      NOW + STATE_TTL_MS + 1000,
    );
    expect(result).toBe("expired");
    expect(calls.filter((c) => c.url.pathname === "/sessions")).toHaveLength(0);
    const [row] = await connections(asA);
    expect(row).toMatchObject({ status: "failed", stateHash: null });
  });

  it("another person's state finds nothing and leaves it alone", async () => {
    const calls = baseRoutes();
    await connect(asA);
    expect(
      await completeCallback(config(), asB, { state: stateOf(calls), code: "c", error: null }, NOW),
    ).toBe("expired");
    expect(await connections(asB)).toEqual([]);
    const [a] = await connections(asA);
    expect(a.status).toBe("pending");
    expect(a.stateHash).not.toBeNull();
    // A can still finish their own link.
    expect(
      await completeCallback(config(), asA, { state: stateOf(calls), code: "c", error: null }, NOW),
    ).toBe("linked");
  });

  it("an error from the bank (cancelled, or anything else) fails the connection and uses the state up", async () => {
    const calls = baseRoutes();
    await connect();
    expect(
      await completeCallback(
        config(),
        asA,
        { state: stateOf(calls), code: null, error: "access_denied" },
        NOW,
      ),
    ).toBe("cancelled");
    await connect();
    expect(
      await completeCallback(
        config(),
        asA,
        { state: stateOf(calls), code: "x", error: "server_error" },
        NOW,
      ),
    ).toBe("failed");
    expect((await connections(asA)).map((c) => c.status)).toEqual(["failed", "failed"]);
    expect(calls.filter((c) => c.url.pathname === "/sessions")).toHaveLength(0);
  });

  it("no state, or one nobody made, is refused", async () => {
    baseRoutes();
    expect(await completeCallback(config(), asA, { state: null, code: "c", error: null })).toBe(
      "expired",
    );
    expect(
      await completeCallback(config(), asA, { state: "made-up", code: "c", error: null }),
    ).toBe("expired");
  });

  it("a session without accounts is ended again and says so", async () => {
    const calls = baseRoutes([["POST /sessions", { body: sessionAnswer([]) }]]);
    await connect();
    expect(
      await completeCallback(config(), asA, { state: stateOf(calls), code: "c", error: null }, NOW),
    ).toBe("noaccounts");
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("a reconnect closes the older connection to the same bank, ends its session and keeps the sync point", async () => {
    let n = 0;
    const calls = baseRoutes([
      [
        "POST /sessions",
        () => ({
          body: {
            ...sessionAnswer([{ uid: `acc-${++n}`, iban: IBAN }]),
            session_id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
          },
        }),
      ],
    ]);
    expect(await linkRabobank(calls)).toBe("linked");
    await asA((db) => db.update(schema.bankLinks).set({ lastSyncedAt: "2026-11-10T08:00:00Z" }));
    expect(await linkRabobank(calls)).toBe("linked");
    const all = await connections(asA);
    expect(all.map((c) => [c.status, c.sessionId])).toEqual([
      ["closed", null],
      ["active", "aaaaaaaa-0000-4000-8000-000000000002"],
    ]);
    const [l] = await links(asA);
    expect(l.accountUid).toBe("acc-2");
    expect(l.lastSyncedAt).toMatch(/^2026-11-10/);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url.pathname)).toEqual([
      "/sessions/aaaaaaaa-0000-4000-8000-000000000001",
    ]);
  });
});

const page = (transactions: unknown[], key?: string) => ({
  body: { transactions, ...(key ? { continuation_key: key } : {}) },
});
const t = (ref: string, amount: string, date: string, over: Record<string, unknown> = {}) => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: amount.startsWith("-") ? "DBIT" : "CRDT",
  status: "BOOK",
  booking_date: date,
  creditor: { name: "Winkel Voorbeeld" },
  debtor: { name: "Voorbeeld Werkgever BV" },
  remittance_information: ["Omschrijving"],
  ...over,
});

describe("sync", () => {
  it("follows continuation keys (an empty page with a key included), books the rows in cents and logs the import", async () => {
    const pages: Record<string, ReturnType<typeof page>> = {
      "": page([t("r1", "-12.50", "2026-11-02"), t("r2", "100.00", "2026-11-03")], "k1"),
      k1: page([], "k2"),
      k2: page([
        t("r3", "-0.29", "2026-11-04", { status: "PDNG" }),
        t("r4", "-7.10", "2026-11-05"),
      ]),
    };
    const calls = baseRoutes([
      [/transactions$/, (c) => pages[c.url.searchParams.get("continuation_key") ?? ""]],
    ]);
    await linkRabobank(calls);
    const reports = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    expect(reports).toEqual([expect.objectContaining({ status: "ok", imported: 3, duplicate: 0 })]);
    const txCalls = calls.filter((c) => c.url.pathname.endsWith("/transactions"));
    expect(txCalls.map((c) => c.url.searchParams.get("continuation_key"))).toEqual([
      null,
      "k1",
      "k2",
    ]);
    expect(txCalls[0].url.searchParams.get("date_from")).toBe("2026-10-19"); // 30 days back the first time
    expect(txCalls[0].url.searchParams.get("transaction_status")).toBe("BOOK");
    const rows = await asA((db) =>
      db.select().from(schema.transactions).orderBy(schema.transactions.date),
    );
    expect(rows.map((r) => [r.date, r.amount, r.counterparty])).toEqual([
      ["2026-11-02", -1250, "Winkel Voorbeeld"],
      ["2026-11-03", 10000, "Voorbeeld Werkgever BV"],
      ["2026-11-05", -710, "Winkel Voorbeeld"],
    ]);
    const [imp] = await asA((db) => db.select().from(schema.imports));
    expect(imp).toMatchObject({
      periodFrom: "2026-11-02", // the earliest row the bank sent, not the date asked for
      periodTo: TODAY,
      rowsImported: 3,
      filename: "Rabobank (Enable Banking)",
    });
    const [l] = await links(asA);
    expect(l.lastSyncedAt).not.toBeNull();
  });

  it("a second sync starts a week before the last one and stores nothing twice", async () => {
    const calls = baseRoutes([[/transactions$/, page([t("r1", "-12.50", "2026-11-02")])]]);
    await linkRabobank(calls);
    await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    const second = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: "2026-11-20",
      now: NOW + 2 * 86_400_000,
    });
    expect(second[0]).toMatchObject({ status: "ok", imported: 0, duplicate: 1 });
    const last = calls.filter((c) => c.url.pathname.endsWith("/transactions")).at(-1)!;
    expect(last.url.searchParams.get("date_from")).toBe("2026-11-11");
    expect(await asA((db) => db.select().from(schema.transactions))).toHaveLength(1);
  });

  it("does not store a row an uploaded file already brought in", async () => {
    // The groceries of 2026-09-02 from tests/fixtures/rabobank-sample.csv, as the bank's API reports them.
    const same = t("bank-ref-77", "-42.37", "2026-09-02", {
      creditor: { name: "Albert Heijn 1234 Amsterdam" },
      balance_after_transaction: { currency: "EUR", amount: "1807.63" },
    });
    const calls = baseRoutes([[/transactions$/, page([same, t("new-1", "-5.00", "2026-11-01")])]]);
    await asA((db) =>
      importStatement(db, {
        content: rabobankCsv(),
        filename: "rabo.csv",
      }),
    );
    const before = (await asA((db) => db.select().from(schema.transactions))).length;
    await linkRabobank(calls);
    // A link that last read in early September (a reconnect), so the refresh reaches back to the uploaded month.
    await asA((db) => db.update(schema.bankLinks).set({ lastSyncedAt: "2026-09-05T12:00:00Z" }));
    const [report] = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    expect(report).toMatchObject({ status: "ok", imported: 1, duplicate: 1 });
    expect(await asA((db) => db.select().from(schema.transactions))).toHaveLength(before + 1);
  });

  it("an expired session marks the connection expired and stores nothing", async () => {
    const calls = baseRoutes([
      [/transactions$/, { status: 401, body: { error: "EXPIRED_SESSION" } }],
    ]);
    await linkRabobank(calls);
    const [report] = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    expect(report.status).toBe("expired");
    expect((await connections(asA))[0].status).toBe("expired");
    expect(await asA((db) => db.select().from(schema.imports))).toEqual([]);
    expect((await asA((db) => listConnections(db, NOW)))[0].status).toBe("expired");
  });

  it("a consent past its end is not asked at all", async () => {
    const calls = baseRoutes();
    await linkRabobank(calls);
    const [report] = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: "2027-06-01",
      now: Date.UTC(2027, 5, 1),
    });
    expect(report.status).toBe("expired");
    expect(calls.some((c) => c.url.pathname.endsWith("/transactions"))).toBe(false);
  });

  it("one account failing stores nothing for it and still syncs the other", async () => {
    const calls = baseRoutes([
      [
        "POST /sessions",
        {
          body: sessionAnswer([
            { uid: "good", iban: IBAN },
            { uid: "bad", iban: IBAN_2 },
          ]),
        },
      ],
      [/good\/transactions$/, page([t("g1", "-1.00", "2026-11-01")])],
      [/bad\/transactions$/, { status: 500, body: { error: "ASPSP_ERROR" } }],
    ]);
    await linkRabobank(calls);
    const reports = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    expect(reports.map((r) => r.status).sort()).toEqual(["failed", "ok"]);
    expect(reports.find((r) => r.status === "failed")!.error).toBe(
      "Enable Banking could not be reached. Try again later.",
    );
    expect(await asA((db) => db.select().from(schema.transactions))).toHaveLength(1);
    expect(await asA((db) => db.select().from(schema.imports))).toHaveLength(1);
  });

  it("stops at the page cap instead of following a bank forever", async () => {
    let n = 0;
    const calls = baseRoutes([[/transactions$/, () => page([], `k${++n}`)]]);
    await linkRabobank(calls);
    const [report] = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    expect(report.status).toBe("failed");
    expect(calls.filter((c) => c.url.pathname.endsWith("/transactions")).length).toBe(50);
  });

  it("a balance the bank names fills in the balance after its transaction", async () => {
    const calls = baseRoutes([
      [/transactions$/, page([t("r1", "-12.50", "2026-11-02")])],
      [
        /balances$/,
        {
          body: {
            balances: [
              {
                name: "Booked",
                balance_type: "CLBD",
                balance_amount: { currency: "EUR", amount: "987.65" },
                last_committed_transaction: "r1",
              },
            ],
          },
        },
      ],
    ]);
    await linkRabobank(calls);
    await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    const [row] = await asA((db) => db.select().from(schema.transactions));
    expect(row.balanceAfter).toBe(98765);
  });
});

describe("disconnect", () => {
  it("ends the session, closes the connection and removes its links; the transactions stay", async () => {
    const calls = baseRoutes([[/transactions$/, page([t("r1", "-12.50", "2026-11-02")])]]);
    await linkRabobank(calls);
    await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    const [c] = await connections(asA);
    await disconnect(config(), asA, c.id);
    expect(calls.filter((x) => x.method === "DELETE").map((x) => x.url.pathname)).toEqual([
      `/sessions/${SESSION_ID}`,
    ]);
    expect((await connections(asA))[0]).toMatchObject({ status: "closed", sessionId: null });
    expect(await links(asA)).toEqual([]);
    expect(await asA((db) => db.select().from(schema.transactions))).toHaveLength(1);
    expect(await asA((db) => listConnections(db, NOW))).toEqual([]);
  });

  it("another person cannot disconnect it, and a session already gone at Enable Banking is fine", async () => {
    const calls = baseRoutes([
      [/^DELETE \/sessions\//, { status: 404, body: { error: "SESSION_DOES_NOT_EXIST" } }],
    ]);
    await linkRabobank(calls);
    const [c] = await connections(asA);
    await expect(disconnect(config(), asB, c.id)).rejects.toBeInstanceOf(ConnectionNotFound);
    expect((await connections(asA))[0].status).toBe("active");
    await disconnect(config(), asA, c.id);
    expect((await connections(asA))[0].status).toBe("closed");
  });

  it("keeps the connection when Enable Banking cannot be reached", async () => {
    const calls = baseRoutes([[/^DELETE \/sessions\//, { status: 503, body: {} }]]);
    await linkRabobank(calls);
    const [c] = await connections(asA);
    await expect(disconnect(config(), asA, c.id)).rejects.toBeInstanceOf(BankingError);
    expect((await connections(asA))[0].status).toBe("active");
  });
});

describe("your data", () => {
  it("is per person: B sees none of A's connections or links, and cannot write rows for A", async () => {
    const calls = baseRoutes();
    await linkRabobank(calls);
    expect(await connections(asB)).toEqual([]);
    expect(await links(asB)).toEqual([]);
    expect(await asB((db) => listConnections(db, NOW))).toEqual([]);
    expect(await asB((db) => sessionIdsOf(db))).toEqual([]);
    const [c] = await connections(asA);
    // B cannot hang a link on A's connection (the composite key finds no such connection for B).
    await expect(
      asB(async (db) => {
        const [acc] = await db
          .insert(schema.accounts)
          .values({ name: "B", bank: "rabobank" })
          .returning();
        await db.insert(schema.bankLinks).values({
          connectionId: c.id,
          accountUid: "x",
          currency: "EUR",
          accountId: acc.id,
        });
      }),
    ).rejects.toThrow();
    // Without a user, the table is closed altogether.
    await expect(root.execute(sql`select * from bank_connections`)).rejects.toThrow();
  });

  it("erase-all removes connections and links; the backup holds neither", async () => {
    const calls = baseRoutes();
    await linkRabobank(calls);
    const backup = JSON.stringify(await asA((db) => buildExport(db)));
    expect(backup).not.toContain(SESSION_ID);
    expect(backup).not.toContain("acc-1");
    expect(await asA((db) => sessionIdsOf(db))).toEqual([SESSION_ID]);
    await asA((db) => deleteAllMyData(db));
    expect(await connections(asA)).toEqual([]);
    expect(await links(asA)).toEqual([]);
  });

  it("the stored rows hold no token and no key", async () => {
    const calls = baseRoutes();
    await linkRabobank(calls);
    const token = calls[0].headers.get("authorization")!.slice(7);
    const stored = JSON.stringify([await connections(asA), await links(asA)]);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain("PRIVATE KEY");
    void eq;
  });
});

describe("sandbox and production stay apart", () => {
  it("a sandbox link is recorded as such, and its imports say so", async () => {
    const calls = baseRoutes([[/transactions$/, page([t("s1", "-1.00", "2026-11-02")])]]);
    await beginConnect(config(), asA, {
      aspsp: { name: "Rabobank", country: "NL" },
      language: "en",
      appUrl: new URL(TEST_APP_URL),
      environment: "SANDBOX",
      now: NOW,
    });
    await completeCallback(config(), asA, { state: stateOf(calls), code: "c", error: null }, NOW);
    expect((await connections(asA))[0].environment).toBe("SANDBOX");
    // Read with a production application: refused, nothing asked, nothing stored.
    const [prod] = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    expect(prod).toMatchObject({ status: "failed" });
    expect(prod.error).toMatch(/another Enable Banking application/);
    expect(calls.some((c) => c.url.pathname.endsWith("/transactions"))).toBe(false);
    // Read with the sandbox application it was made with: the import is findable by its name.
    await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "SANDBOX",
      today: TODAY,
      now: NOW,
    });
    const [imp] = await asA((db) => db.select().from(schema.imports));
    expect(imp.filename).toBe("Rabobank (Enable Banking sandbox)");
  });
});

describe("sync limits", () => {
  /** A bank that takes `stepMs` of (fake) time per page of transactions. */
  function slowBank(stepMs: number, pages: Record<string, ReturnType<typeof page>>) {
    let clock = NOW;
    const calls = baseRoutes([
      [
        /transactions$/,
        (c) => {
          clock += stepMs;
          const uid = c.url.pathname.split("/")[2];
          return pages[`${uid}:${c.url.searchParams.get("continuation_key") ?? ""}`] ?? page([]);
        },
      ],
      [
        "POST /sessions",
        {
          body: sessionAnswer([
            { uid: "one", iban: IBAN },
            { uid: "two", iban: IBAN_2 },
            { uid: "three" },
          ]),
        },
      ],
    ]);
    return { calls, clock: () => clock };
  }

  it("stops at the deadline: what was read is saved, the rest waits for the next refresh", async () => {
    const { calls, clock } = slowBank(30_000, {
      "one:": page([t("o1", "-1.00", "2026-11-02")]),
      "two:": page([t("w1", "-2.00", "2026-11-03")], "more"),
      "two:more": page([t("w2", "-3.00", "2026-11-04")]),
      "three:": page([t("h1", "-4.00", "2026-11-05")]),
    });
    await linkRabobank(calls);
    const reports = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
      clock,
    });
    expect(reports.map((r) => r.status)).toEqual(["ok", "stopped", "stopped"]);
    expect(reports[1].error).toMatch(/Refresh again/);
    const rows = await asA((db) => db.select().from(schema.transactions));
    expect(rows.map((r) => r.amount)).toEqual([-100]); // the first account only, nothing half of the second
    const synced = (await links(asA))
      .sort((a, b) => a.id - b.id)
      .map((l) => [l.accountUid, l.lastSyncedAt !== null]);
    expect(synced).toEqual([
      ["one", true],
      ["two", false],
      ["three", false],
    ]);
    // The next refresh (a fresh deadline) goes on with the rest.
    const again = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
      clock: () => NOW,
    });
    expect(again.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(await asA((db) => db.select().from(schema.transactions))).toHaveLength(4);
  });

  it("an account over its byte budget fails; the whole refresh over its budget stops early", async () => {
    const big = page(Array.from({ length: 40 }, (_, i) => t(`b${i}`, "-1.00", "2026-11-02")));
    const { calls } = slowBank(0, { "one:": big, "two:": big, "three:": big });
    await linkRabobank(calls);
    const bytes = JSON.stringify(big.body).length;
    const perLink = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
      limits: { linkBytes: bytes - 1 },
    });
    expect(perLink.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    const perRun = await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
      limits: { runBytes: bytes * 2 - 1 },
    });
    expect(perRun.map((r) => r.status)).toEqual(["ok", "stopped", "stopped"]);
  });
});

describe("the review's smaller points", () => {
  it("a new account shows only the last four characters of its IBAN; the full IBAN is kept for matching", async () => {
    const calls = baseRoutes();
    await linkRabobank(calls);
    const [account] = await asA((db) => db.select().from(schema.accounts));
    expect(account.name).toBe("Rabobank ••0001");
    expect(account.iban).toBe(IBAN);
  });

  it("an IBAN with wrong check digits is not trusted: no match, no IBAN stored", async () => {
    const calls = baseRoutes([
      ["POST /sessions", { body: sessionAnswer([{ uid: "x", iban: "NL00RABO0000000001" }]) }],
    ]);
    await linkRabobank(calls);
    const [account] = await asA((db) => db.select().from(schema.accounts));
    expect(account).toMatchObject({ name: "Rabobank", iban: null });
  });

  it("the consent's end is never stored later than 180 days from now", async () => {
    const calls = baseRoutes([
      [
        "POST /sessions",
        { body: sessionAnswer([{ uid: "a", iban: IBAN }], "2031-01-01T00:00:00Z") },
      ],
    ]);
    await linkRabobank(calls);
    const [c] = await connections(asA);
    const stored = Date.parse(c.validUntil!.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    expect(stored).toBeLessThanOrEqual(NOW + 60_000 + 180 * 86_400_000);
    expect(stored).toBeGreaterThan(NOW + 179 * 86_400_000);
  });

  it("without a configuration a disconnect closes the connection here and says the bank was not told", async () => {
    const calls = baseRoutes();
    await linkRabobank(calls);
    const [c] = await connections(asA);
    expect(await disconnect(null, asA, c.id)).toEqual({ revoked: false });
    expect((await connections(asA))[0]).toMatchObject({ status: "closed", sessionId: null });
    expect(calls.some((x) => x.method === "DELETE")).toBe(false);
  });

  it("without a configuration, ending sessions logs only how many were skipped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await revokeSessions(null, [SESSION_ID, "bbbbbbbb-0000-4000-8000-000000000002"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("2 bank session(s)");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SESSION_ID);
    warn.mockRestore();
  });

  it("a state arnaq could not have made is not looked up at all", async () => {
    baseRoutes();
    const run = vi.fn(asA) as unknown as RunAsUser;
    expect(
      await completeCallback(config(), run, { state: "x".repeat(44), code: "c", error: null }),
    ).toBe("expired");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the person is there: PSU headers", () => {
  // A plain getter, so even values a real Headers object would refuse can be tried.
  const request = (headers: Record<string, string>) => ({
    get: (name: string) => headers[name] ?? null,
  });

  it("are only made from checked values, and not at all without a valid IP address", () => {
    const psu = psuHeadersFromRequest(
      request({
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "Mozilla/5.0 (Voorbeeld)",
        "accept-language": "nl-NL,nl;q=0.9",
        accept: "text/html,*/*;q=0.8",
        "accept-encoding": "gzip, br",
      }),
    );
    expect(psu).toEqual({
      "Psu-Ip-Address": "203.0.113.7",
      "Psu-User-Agent": "Mozilla/5.0 (Voorbeeld)",
      "Psu-Accept-Language": "nl-NL,nl;q=0.9",
      "Psu-Accept": "text/html,*/*;q=0.8",
      "Psu-Accept-Encoding": "gzip, br",
    });
    expect(psuHeadersFromRequest(request({ "x-forwarded-for": "2001:db8::1" }))).toEqual({
      "Psu-Ip-Address": "2001:db8::1",
    });
    for (const ip of ["", "not-an-ip", "999.1.1.1", "203.0.113.7\r\nX-Evil: 1"])
      expect(psuHeadersFromRequest(request({ "x-forwarded-for": ip })), ip).toBeNull();
    expect(psuHeadersFromRequest(request({ "user-agent": "x" }))).toBeNull();
    // A value that fails its check is left out; an overlong one is capped.
    const odd = psuHeadersFromRequest(
      request({
        "x-forwarded-for": "203.0.113.7",
        "accept-language": "nl<script>",
        "user-agent": "a".repeat(999),
      }),
    )!;
    expect(odd["Psu-Accept-Language"]).toBeUndefined();
    expect(odd["Psu-User-Agent"]).toHaveLength(300);
  });

  it("go to the bank when the person pressed Refresh, and never on a background sync", async () => {
    const calls = baseRoutes([[/transactions$/, page([t("p1", "-1.00", "2026-11-02")])]]);
    await linkRabobank(calls);
    const psu = psuHeadersFromRequest(
      request({ "x-forwarded-for": "203.0.113.7", "user-agent": "UA" }),
    );
    await syncBankLinks(config(), asA, {
      presence: { by: "pressed-refresh", psu },
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    const pressed = calls.filter((c) => c.url.pathname.startsWith("/accounts/"));
    expect(pressed.length).toBeGreaterThan(0);
    for (const c of pressed) {
      expect(c.headers.get("psu-ip-address")).toBe("203.0.113.7");
      expect(c.headers.get("psu-user-agent")).toBe("UA");
    }
    // Calls that are not about reading the account never carry them.
    expect(
      calls.find((c) => c.url.pathname === "/sessions")!.headers.get("psu-ip-address"),
    ).toBeNull();

    const before = calls.length;
    await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    const background = calls.slice(before);
    expect(background.length).toBeGreaterThan(0);
    for (const c of background)
      expect([...c.headers.keys()].some((k) => k.startsWith("psu-"))).toBe(false);
  });

  it("cannot be sent by accident: the caller must say who is asking, and a plain object is not PSU headers", () => {
    const fake = { "Psu-Ip-Address": "203.0.113.7" };
    // @ts-expect-error -- `presence` is required: a sync has to say whether the person pressed the button.
    const missing: Parameters<typeof syncBankLinks>[2] = {
      environment: "PRODUCTION",
      today: TODAY,
    };
    type Presence = Parameters<typeof syncBankLinks>[2]["presence"];
    const pressed = (psu: typeof fake) => ({ by: "pressed-refresh" as const, psu });
    // @ts-expect-error -- only psuHeadersFromRequest makes PSU headers.
    const forged: Presence = pressed(fake);
    // @ts-expect-error -- a background sync has no place for them at all.
    const sneaky: Parameters<typeof syncBankLinks>[2]["presence"] = { by: "background", psu: null };
    expect([missing, forged, sneaky]).toHaveLength(3);
  });
});

describe("which months a sync covers", () => {
  it("only from the earliest transaction the bank sent, never from the date asked for", async () => {
    // Asked for 90 days (a reconnect that kept an old sync date), the bank sends only the last 30.
    const recent = Array.from({ length: 30 }, (_, i) =>
      t(`c${i}`, "-1.00", new Date(NOW - i * 86_400_000).toISOString().slice(0, 10)),
    );
    const calls = baseRoutes([[/transactions$/, page(recent)]]);
    await linkRabobank(calls);
    await asA((db) => db.update(schema.bankLinks).set({ lastSyncedAt: "2026-08-27T12:00:00Z" }));
    await syncBankLinks(config(), asA, {
      presence: BG,
      environment: "PRODUCTION",
      today: TODAY,
      now: NOW,
    });
    const asked = calls.filter((c) => c.url.pathname.endsWith("/transactions")).at(-1)!;
    expect(asked.url.searchParams.get("date_from")).toBe("2026-08-20");
    const [imp] = await asA((db) => db.select().from(schema.imports));
    expect(imp.periodFrom).toBe("2026-10-20");
    const covered = await asA((db) => coveredMonths(db));
    expect(covered.has("2026-08")).toBe(false);
    expect(covered.has("2026-09")).toBe(false);
    expect(covered.has("2026-10")).toBe(false); // it starts on the 20th: not all of October came
  });

  it("claims nothing when the bank sent nothing", () => {
    expect(coveredPeriod([], "2026-10-19", TODAY)).toBeNull();
  });
});
