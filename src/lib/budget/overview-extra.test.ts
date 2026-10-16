import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { getDailySpend, getMonthOverview, getOtherIncome } from "./overview";

async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "A", bank: "rabobank" })
    .returning();
  const cat = async (name: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;
  let n = 0;
  const tx = async (
    date: string,
    amount: number,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    await one(
      db
        .insert(schema.transactions)
        .values({ accountId: account.id, date, amount, importHash: `h${n++}`, ...extra })
        .returning(),
    );
  return { db, account, cat, tx };
}

describe("getDailySpend", () => {
  it("sums money out per day, as long as the month, on the overview's basis", async () => {
    const { db, account, cat, tx } = await setup();
    await tx("2026-10-02", -5000);
    await tx("2026-10-02", -1250, { categoryId: await cat("Boodschappen") });
    await tx("2026-10-05", 20000); // money in: not spending
    await tx("2026-10-06", -9999, { isInternalTransfer: true }); // between own accounts
    await tx("2026-10-07", -4000, { currency: "USD" }); // not in the account's currency
    await tx("2026-11-01", -777); // another month
    // A payment tied to a fixed cost is not everyday spending.
    const [item] = await db
      .insert(schema.recurringItems)
      .values({
        name: "Huur",
        type: "expense",
        expectedAmount: 80000,
        dayOfMonth: 1,
        startDate: "2026-01-01",
      })
      .returning();
    const [occ] = await db
      .insert(schema.recurringOccurrences)
      .values({
        recurringItemId: item.id,
        month: "2026-10",
        expectedDate: "2026-10-01",
        expectedAmount: 80000,
        status: "matched",
      })
      .returning();
    await tx("2026-10-01", -80000, { matchedOccurrenceId: occ.id });
    void account;

    const days = await getDailySpend(db, "2026-10");
    expect(days).toHaveLength(31);
    expect(days[1]).toBe(6250);
    expect(days.reduce((s, d) => s + d, 0)).toBe(6250);
    expect(await getDailySpend(db, "2026-02")).toHaveLength(28);
  });
});

describe("getOtherIncome", () => {
  it("groups money in by category, newest date, biggest first; transfers and foreign rows excluded", async () => {
    const { db, cat, tx } = await setup();
    const gift = await cat("Familie / gift");
    await tx("2026-10-12", 5000, { categoryId: gift });
    await tx("2026-10-20", 2500, { categoryId: gift });
    await tx("2026-10-03", 11000); // not categorised
    await tx("2026-10-04", 9000, { isInternalTransfer: true });
    await tx("2026-10-05", 7000, { currency: "USD" });
    await tx("2026-10-06", -3000, { categoryId: gift }); // out: not income
    await tx("2026-09-30", 1234, { categoryId: gift });

    const lines = await getOtherIncome(db, "2026-10");
    expect(lines).toEqual([
      { categoryId: null, name: null, amount: 11000, lastDate: "2026-10-03" },
      { categoryId: gift, name: "Familie / gift", amount: 7500, lastDate: "2026-10-20" },
    ]);
  });
});

describe("getMonthOverview.transactionCount", () => {
  it("counts the rows the numbers are made of (not transfers, not foreign currency)", async () => {
    const { db, cat, tx } = await setup();
    await tx("2026-10-02", -5000, { categoryId: await cat("Boodschappen") });
    await tx("2026-10-03", -1000); // not categorised, still counted
    await tx("2026-10-04", -1000, { isInternalTransfer: true });
    await tx("2026-10-05", -1000, { currency: "USD" });
    const o = await getMonthOverview(db, "2026-10");
    expect(o.transactionCount).toBe(2);
    expect(o.foreignCurrencyCount).toBe(1);
  });
});
