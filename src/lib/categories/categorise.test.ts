import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { one, createDb, schema } from "@/db";
import { DEFAULT_CATEGORIES } from "./defaults";
import {
  CategoriseError,
  assignCategory,
  applyRules,
  getNeedsReview,
  matchRule,
  sortRules,
} from "./categorise";

async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "A", bank: "rabobank", iban: "NL1" })
    .returning();
  const cat = async (name: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!;
  let n = 0;
  const addTx = async (v: Partial<typeof schema.transactions.$inferInsert>) =>
    await one(
      db
        .insert(schema.transactions)
        .values({
          accountId: account.id,
          date: "2026-09-01",
          amount: -100,
          importHash: `h${n++}`,
          ...v,
        })
        .returning(),
    );
  return { db, account, cat, addTx };
}

describe("seed", () => {
  it("creates the default categories and starter rules once", async () => {
    const { db } = await setup();
    expect(await db.select().from(schema.categories)).toHaveLength(DEFAULT_CATEGORIES.length);
    const rules = (await db.select().from(schema.categorisationRules)).length;
    expect(rules).toBeGreaterThan(20);
  });
});

describe("rule matching", () => {
  const rules = sortRules([
    { id: 1, pattern: "uber", categoryId: 1, priority: 5 },
    { id: 2, pattern: "uber eats", categoryId: 2, priority: 20 },
    { id: 3, pattern: "huur", categoryId: 3, priority: 5 },
    { id: 4, pattern: "huurtoeslag", categoryId: 4, priority: 30 },
  ]);
  it("higher priority wins over a shorter, lower-priority pattern", () => {
    expect(matchRule(rules, { counterparty: "UBER EATS NL", description: null })?.categoryId).toBe(
      2,
    );
    expect(matchRule(rules, { counterparty: "Uber", description: null })?.categoryId).toBe(1);
  });
  it("matches case-insensitively on counterparty and description", () => {
    expect(
      matchRule(rules, { counterparty: "Belastingdienst", description: "Huurtoeslag oktober" })
        ?.categoryId,
    ).toBe(4);
    expect(matchRule(rules, { counterparty: null, description: "Huur" })?.categoryId).toBe(3);
  });
  it("returns undefined when nothing matches; ignores empty patterns", () => {
    expect(matchRule(rules, { counterparty: "Bakkerij", description: null })).toBeUndefined();
    expect(
      matchRule([{ id: 9, pattern: " ", categoryId: 1, priority: 1 }], {
        counterparty: "x",
        description: "y",
      }),
    ).toBeUndefined();
  });
});

describe("applyRules", () => {
  it("categorises matching uncategorised rows and leaves the rest for review", async () => {
    const { db, addTx, cat } = await setup();
    const ah = await addTx({ counterparty: "Albert Heijn 1234" });
    const unknown = await addTx({ counterparty: "Koffie Voorbeeld" });
    expect(await applyRules(db)).toBe(1);
    expect(
      (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, ah.id))))
        ?.categoryId,
    ).toBe((await cat("Boodschappen")).id);
    expect((await getNeedsReview(db)).map((t) => t.id)).toEqual([unknown.id]);
  });

  it("never overwrites a category the user set by hand", async () => {
    const { db, addTx, cat } = await setup();
    const t = await addTx({ counterparty: "Albert Heijn", categoryId: (await cat("Overig")).id });
    await applyRules(db);
    expect(
      (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id))))
        ?.categoryId,
    ).toBe((await cat("Overig")).id);
  });
});

describe("needs review", () => {
  it("lists foreign-currency rows even when they have a category, and hides internal transfers", async () => {
    const { db, addTx, cat } = await setup();
    const gbp = await addTx({ currency: "GBP", categoryId: (await cat("Vervoer")).id });
    await addTx({ isInternalTransfer: true });
    const review = await getNeedsReview(db);
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ id: gbp.id, reason: "foreign-currency" });
  });
});

describe("assignCategory", () => {
  it("assigns and can learn a rule that categorises the other matching rows", async () => {
    const { db, addTx, cat } = await setup();
    const a = await addTx({ counterparty: "Koffie Voorbeeld" });
    const b = await addTx({ counterparty: "Koffie Voorbeeld", date: "2026-09-02" });
    const res = await assignCategory(db, a.id, (await cat("Eten & drinken")).id, {
      createRule: true,
    });
    expect(res.ruleId).not.toBeNull();
    expect(res.alsoCategorised).toBe(1);
    expect(
      (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, b.id))))
        ?.categoryId,
    ).toBe((await cat("Eten & drinken")).id);
    expect(await getNeedsReview(db)).toHaveLength(0);
  });

  it("assigning the transfer category flags it as internal; moving away clears it", async () => {
    const { db, addTx, cat } = await setup();
    const t = await addTx({});
    await assignCategory(db, t.id, (await cat("Interne overboeking")).id);
    expect(
      (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id))))
        ?.isInternalTransfer,
    ).toBe(true);
    await assignCategory(db, t.id, (await cat("Overig")).id);
    expect(
      (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id))))
        ?.isInternalTransfer,
    ).toBe(false);
  });

  it("rejects unknown ids", async () => {
    const { db, addTx } = await setup();
    const t = await addTx({});
    await expect(assignCategory(db, 999, 1)).rejects.toThrow(CategoriseError);
    await expect(assignCategory(db, t.id, 999)).rejects.toThrow(CategoriseError);
  });
});
