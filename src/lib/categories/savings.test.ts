import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { applyLearned, ensureMerchantKeys } from "@/lib/smart/learned";
import { assignCategory } from "./categorise";
import { SAVINGS_CATEGORY } from "./defaults";
import { ensureSavingsCategory } from "./seed";

async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "Revolut", bank: "revolut" })
    .returning();
  const cat = async (name: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;
  let n = 0;
  const tx = async (counterparty: string, amount: number, date = "2026-10-05") =>
    (await one(
      db
        .insert(schema.transactions)
        .values({ accountId: account.id, date, amount, counterparty, importHash: `h${n++}` })
        .returning(),
    ))!;
  const get = async (id: number) =>
    (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, id))))!;
  return { db, cat, tx, get };
}

describe("the Savings category", () => {
  it("is a default category of its own type", async () => {
    const { db } = await setup();
    const rows = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, SAVINGS_CATEGORY));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "savings", slug: "savings" });
  });

  it("is added for a person who already had an account without it, and only once", async () => {
    const { db } = await setup();
    await db.delete(schema.categories).where(eq(schema.categories.name, SAVINGS_CATEGORY));
    await ensureSavingsCategory(db);
    await ensureSavingsCategory(db);
    expect(
      await db.select().from(schema.categories).where(eq(schema.categories.type, "savings")),
    ).toHaveLength(1);
  });

  it("takes a transaction out of income and spending, and is remembered for both directions", async () => {
    const { db, cat, tx, get } = await setup();
    const savings = await cat(SAVINGS_CATEGORY);
    const out = await tx("To Instant Access Savings", -10000);
    const result = await assignCategory(db, out.id, savings, { learn: true });
    expect(await get(out.id)).toMatchObject({
      isInternalTransfer: true,
      categoryId: savings,
      categorySource: "user",
    });
    expect(result.ruleId).toBeNull();

    // The same pot, either way: money back out of it is also savings, never income.
    const back = await tx("To Instant Access Savings", 4000, "2026-10-20");
    const next = await tx("To Instant Access Savings", -5000, "2026-11-03");
    await ensureMerchantKeys(db);
    expect(await applyLearned(db)).toBe(2);
    expect(await get(back.id)).toMatchObject({
      isInternalTransfer: true,
      categoryId: savings,
      categorySource: "learned",
    });
    expect(await get(next.id)).toMatchObject({ isInternalTransfer: true, categoryId: savings });
  });

  it("putting a row back to a normal category clears the flag", async () => {
    const { db, cat, tx, get } = await setup();
    const savings = await cat(SAVINGS_CATEGORY);
    const groceries = await cat("Boodschappen");
    const t = await tx("Jumbo", -2000);
    await assignCategory(db, t.id, savings);
    await assignCategory(db, t.id, groceries);
    expect(await get(t.id)).toMatchObject({ isInternalTransfer: false, categoryId: groceries });
  });
});
