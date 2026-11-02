import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { getDailyBalances, getOpeningBalance } from "./balance";

async function setup() {
  const db = await createDb(":memory:");
  const account = async (name: string, currency = "EUR") =>
    (await one(
      db.insert(schema.accounts).values({ name, bank: "rabobank", currency }).returning(),
    ))!;
  let n = 0;
  const tx = async (
    accountId: number,
    date: string,
    amount: number,
    balanceAfter: number | null,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    db
      .insert(schema.transactions)
      .values({ accountId, date, amount, balanceAfter, importHash: `h${n++}`, ...extra });
  return { db, account, tx };
}

describe("getOpeningBalance", () => {
  it("is null when no transaction states a balance", async () => {
    const { db, account, tx } = await setup();
    const a = await account("A");
    await tx(a.id, "2026-09-05", -1000, null);
    expect(await getOpeningBalance(db, "2026-09")).toBeNull();
  });

  it("takes the balance after the last transaction before the month, per account, and adds the accounts", async () => {
    const { db, account, tx } = await setup();
    const a = await account("A");
    const b = await account("B");
    await tx(a.id, "2026-08-20", -1000, 90000);
    await tx(a.id, "2026-08-31", -500, 89500); // the last one before September
    await tx(a.id, "2026-09-02", -2000, 87500);
    await tx(b.id, "2026-08-10", 3000, 20000);
    expect(await getOpeningBalance(db, "2026-09")).toBe(89500 + 20000);
  });

  it("with nothing before the month, works back from the first transaction (balance after minus its amount)", async () => {
    const { db, account, tx } = await setup();
    const a = await account("A");
    await tx(a.id, "2026-09-02", -4237, 180763);
    await tx(a.id, "2026-09-03", -999, 179764);
    expect(await getOpeningBalance(db, "2026-09")).toBe(185000);
  });

  it("two on one day: the later one counts; accounts without balances and foreign rows do not", async () => {
    const { db, account, tx } = await setup();
    const a = await account("A");
    const none = await account("No balances");
    await tx(a.id, "2026-08-31", -100, 9900);
    await tx(a.id, "2026-08-31", -200, 9700); // same day, inserted later
    await tx(a.id, "2026-08-31", -300, 1, { currency: "USD" }); // not in the account's currency
    await tx(none.id, "2026-08-31", -50, null);
    expect(await getOpeningBalance(db, "2026-09")).toBe(9700);
  });
});

describe("getDailyBalances", () => {
  it("is null when no transaction states a balance", async () => {
    const { db, account, tx } = await setup();
    const a = await account("A");
    await tx(a.id, "2026-09-05", -1000, null);
    expect(await getDailyBalances(db, "2026-09-01", "2026-09-30")).toBeNull();
  });

  it("gives the end-of-day balance of all accounts together for every day, the later row of a day winning", async () => {
    const { db, account, tx } = await setup();
    const a = await account("Rabo");
    const b = await account("Revolut");
    await tx(a.id, "2026-08-31", -500, 10000);
    await tx(a.id, "2026-09-02", -2000, 8000);
    await tx(a.id, "2026-09-02", 500, 8500); // same day, later row
    await tx(a.id, "2026-09-02", -9999, 1, { currency: "USD" }); // other currency: ignored
    await tx(b.id, "2026-09-03", -300, 4700); // first row: Revolut held 5000 before it
    const days = (await getDailyBalances(db, "2026-09-01", "2026-09-04"))!;
    expect([...days]).toEqual([
      ["2026-09-01", 10000 + 5000],
      ["2026-09-02", 8500 + 5000],
      ["2026-09-03", 8500 + 4700],
      ["2026-09-04", 8500 + 4700],
    ]);
  });

  it("agrees with getOpeningBalance on the day before a month starts", async () => {
    const { db, account, tx } = await setup();
    const a = await account("A");
    await tx(a.id, "2026-09-02", -4237, 180763);
    await tx(a.id, "2026-10-03", -999, 179764);
    const days = (await getDailyBalances(db, "2026-09-30", "2026-09-30"))!;
    expect(days.get("2026-09-30")).toBe(await getOpeningBalance(db, "2026-10"));
  });
});
