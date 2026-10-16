import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { getOpeningBalance } from "./balance";

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
