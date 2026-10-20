import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { SAVINGS_CATEGORY } from "@/lib/categories/defaults";
import { getSavingsSettings, SavingsError, setSavingsSettings } from "./settings";
import { getSavingsSummary } from "./summary";

async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "Revolut", bank: "revolut" })
    .returning();
  const cat = async (name: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;
  const savings = await cat(SAVINGS_CATEGORY);
  let n = 0;
  const tx = async (
    date: string,
    amount: number,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    one(
      db
        .insert(schema.transactions)
        .values({
          accountId: account.id,
          date,
          amount,
          importHash: `h${n++}`,
          categoryId: savings,
          isInternalTransfer: true,
          ...extra,
        })
        .returning(),
    );
  return { db, cat, savings, tx };
}

describe("getSavingsSummary", () => {
  it("counts deposits up and withdrawals down, and says how much of the month", async () => {
    const { db, tx } = await setup();
    await tx("2026-08-10", -20000); // deposited 200 (money left the current account)
    await tx("2026-09-05", -10000); // deposited 100
    await tx("2026-09-20", 4000); // took 40 out
    const s = await getSavingsSummary(db, { today: "2026-09-25" });
    expect(s).toMatchObject({ saved: 26000, thisMonth: 6000, lines: 3, goal: null, start: 0 });
  });

  it("starts from what was saved before the first upload, and knows the goal", async () => {
    const { db, tx } = await setup();
    await setSavingsSettings(db, { goal: 500000, start: 120000 });
    await tx("2026-09-05", -10000);
    expect(await getSavingsSummary(db, { today: "2026-09-25" })).toMatchObject({
      goal: 500000,
      start: 120000,
      saved: 130000,
    });
  });

  it("can report another month than today's", async () => {
    const { db, tx } = await setup();
    await tx("2026-08-10", -20000);
    await tx("2026-09-05", -10000);
    expect(await getSavingsSummary(db, { today: "2026-09-25", month: "2026-08" })).toMatchObject({
      saved: 30000,
      thisMonth: 20000,
    });
  });

  it("can go down when more comes out than went in", async () => {
    const { db, tx } = await setup();
    await tx("2026-09-05", 25000);
    expect(await getSavingsSummary(db, { today: "2026-09-25" })).toMatchObject({
      saved: -25000,
      thisMonth: -25000,
    });
  });

  it("ignores other categories, other months for the month figure, and foreign currency", async () => {
    const { db, cat, tx } = await setup();
    await tx("2026-09-05", -5000, {
      categoryId: await cat("Boodschappen"),
      isInternalTransfer: false,
    });
    await tx("2026-09-06", -3000, { currency: "USD" });
    await tx("2026-08-31", -1000);
    const s = await getSavingsSummary(db, { today: "2026-09-25" });
    expect(s).toMatchObject({ saved: 1000, thisMonth: 0, lines: 1 });
  });
});

describe("savings settings", () => {
  it("are empty by default, can be set, and the goal can be cleared", async () => {
    const { db } = await setup();
    expect(await getSavingsSettings(db)).toEqual({ goal: null, start: 0 });
    await setSavingsSettings(db, { goal: 100000, start: 5000 });
    expect(await getSavingsSettings(db)).toEqual({ goal: 100000, start: 5000 });
    await setSavingsSettings(db, { goal: null });
    expect(await getSavingsSettings(db)).toEqual({ goal: null, start: 5000 });
  });

  it("refuse nonsense", async () => {
    const { db } = await setup();
    for (const bad of [
      { goal: 0 },
      { goal: -5 },
      { goal: 1.5 },
      { start: -1 },
      { start: 2.5 },
      { goal: 10 ** 13 },
    ])
      await expect(setSavingsSettings(db, bad)).rejects.toBeInstanceOf(SavingsError);
  });
});
