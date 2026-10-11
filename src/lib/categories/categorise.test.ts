import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { DEFAULT_CATEGORIES } from "./defaults";
import {
  CategoriseError,
  assignCategory,
  applyRules,
  getNeedsReview,
  matchRule,
  sortRules,
} from "./categorise";

function setup() {
  const db = createDb(":memory:");
  const [account] = db
    .insert(schema.accounts)
    .values({ name: "A", bank: "rabobank", iban: "NL1" })
    .returning()
    .all();
  const cat = (name: string) =>
    db.select().from(schema.categories).where(eq(schema.categories.name, name)).get()!;
  let n = 0;
  const addTx = (v: Partial<typeof schema.transactions.$inferInsert>) =>
    db
      .insert(schema.transactions)
      .values({
        accountId: account.id,
        date: "2026-09-01",
        amount: -100,
        importHash: `h${n++}`,
        ...v,
      })
      .returning()
      .get();
  return { db, account, cat, addTx };
}

describe("seed", () => {
  it("creates the default categories and starter rules once", () => {
    const { db } = setup();
    expect(db.select().from(schema.categories).all()).toHaveLength(DEFAULT_CATEGORIES.length);
    const rules = db.select().from(schema.categorisationRules).all().length;
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
  it("categorises matching uncategorised rows and leaves the rest for review", () => {
    const { db, addTx, cat } = setup();
    const ah = addTx({ counterparty: "Albert Heijn 1234" });
    const unknown = addTx({ counterparty: "Koffie Voorbeeld" });
    expect(applyRules(db)).toBe(1);
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, ah.id)).get()
        ?.categoryId,
    ).toBe(cat("Boodschappen").id);
    expect(getNeedsReview(db).map((t) => t.id)).toEqual([unknown.id]);
  });

  it("never overwrites a category the user set by hand", () => {
    const { db, addTx, cat } = setup();
    const t = addTx({ counterparty: "Albert Heijn", categoryId: cat("Overig").id });
    applyRules(db);
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id)).get()
        ?.categoryId,
    ).toBe(cat("Overig").id);
  });
});

describe("needs review", () => {
  it("lists foreign-currency rows even when they have a category, and hides internal transfers", () => {
    const { db, addTx, cat } = setup();
    const gbp = addTx({ currency: "GBP", categoryId: cat("Vervoer").id });
    addTx({ isInternalTransfer: true });
    const review = getNeedsReview(db);
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ id: gbp.id, reason: "foreign-currency" });
  });
});

describe("assignCategory", () => {
  it("assigns and can learn a rule that categorises the other matching rows", () => {
    const { db, addTx, cat } = setup();
    const a = addTx({ counterparty: "Koffie Voorbeeld" });
    const b = addTx({ counterparty: "Koffie Voorbeeld", date: "2026-09-02" });
    const res = assignCategory(db, a.id, cat("Eten & drinken").id, { createRule: true });
    expect(res.ruleId).not.toBeNull();
    expect(res.alsoCategorised).toBe(1);
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, b.id)).get()
        ?.categoryId,
    ).toBe(cat("Eten & drinken").id);
    expect(getNeedsReview(db)).toHaveLength(0);
  });

  it("assigning the transfer category flags it as internal; moving away clears it", () => {
    const { db, addTx, cat } = setup();
    const t = addTx({});
    assignCategory(db, t.id, cat("Interne overboeking").id);
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id)).get()
        ?.isInternalTransfer,
    ).toBe(true);
    assignCategory(db, t.id, cat("Overig").id);
    expect(
      db.select().from(schema.transactions).where(eq(schema.transactions.id, t.id)).get()
        ?.isInternalTransfer,
    ).toBe(false);
  });

  it("rejects unknown ids", () => {
    const { db, addTx } = setup();
    const t = addTx({});
    expect(() => assignCategory(db, 999, 1)).toThrow(CategoriseError);
    expect(() => assignCategory(db, t.id, 999)).toThrow(CategoriseError);
  });
});
