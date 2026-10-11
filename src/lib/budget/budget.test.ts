import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, schema } from "@/db";
import { BudgetError, copyBudgets, setBudget, setTotalBudget, clearBudget } from "./budgets";
import { getMonthOverview } from "./overview";

function setup() {
  const db = createDb(":memory:");
  const [account] = db
    .insert(schema.accounts)
    .values({ name: "A", bank: "rabobank" })
    .returning()
    .all();
  const cat = (name: string) =>
    db.select().from(schema.categories).where(eq(schema.categories.name, name)).get()!.id;
  let n = 0;
  const tx = (
    date: string,
    amount: number,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    db
      .insert(schema.transactions)
      .values({ accountId: account.id, date, amount, importHash: `h${n++}`, ...extra })
      .returning()
      .get();
  return { db, cat, tx };
}
const line = <T extends { name: string }>(lines: T[], name: string) =>
  lines.find((l) => l.name === name)!;

describe("budgets", () => {
  it("upserts, clears and validates", () => {
    const { db, cat } = setup();
    setBudget(db, cat("Boodschappen"), "2026-09", 25000);
    setBudget(db, cat("Boodschappen"), "2026-09", 30000);
    expect(db.select().from(schema.budgets).all()).toHaveLength(1);
    expect(db.select().from(schema.budgets).get()?.amount).toBe(30000);
    clearBudget(db, cat("Boodschappen"), "2026-09");
    expect(db.select().from(schema.budgets).all()).toHaveLength(0);
    expect(() => setBudget(db, 1, "2026-9", 100)).toThrow(BudgetError);
    expect(() => setBudget(db, 1, "2026-09", 10.5)).toThrow(BudgetError);
    expect(() => setBudget(db, 1, "2026-09", -1)).toThrow(BudgetError);
  });

  it("copies budgets and total to another month", () => {
    const { db, cat } = setup();
    setBudget(db, cat("Huur"), "2026-09", 65000);
    setBudget(db, cat("Boodschappen"), "2026-09", 25000);
    setTotalBudget(db, "2026-09", 150000);
    expect(copyBudgets(db, "2026-09", "2026-10")).toBe(2);
    expect(getMonthOverview(db, "2026-10").totals.totalBudget).toBe(150000);
  });
});

describe("getMonthOverview", () => {
  it("computes budget vs actual per category with integer cents", () => {
    const { db, cat, tx } = setup();
    setBudget(db, cat("Boodschappen"), "2026-09", 20000);
    tx("2026-09-02", -4237, { categoryId: cat("Boodschappen") });
    tx("2026-09-20", -1763, { categoryId: cat("Boodschappen") });
    tx("2026-09-21", 500, { categoryId: cat("Boodschappen") }); // refund
    const o = getMonthOverview(db, "2026-09");
    expect(line(o.expenses, "Boodschappen")).toMatchObject({
      budget: 20000,
      actual: 5500,
      remaining: 14500,
    });
    expect(line(o.expenses, "Huur")).toMatchObject({ budget: null, actual: 0, remaining: null });
  });

  it("only counts the requested calendar month", () => {
    const { db, cat, tx } = setup();
    tx("2026-08-31", -1000, { categoryId: cat("Overig") });
    tx("2026-09-01", -2000, { categoryId: cat("Overig") });
    tx("2026-10-01", -4000, { categoryId: cat("Overig") });
    expect(line(getMonthOverview(db, "2026-09").expenses, "Overig").actual).toBe(2000);
  });

  it("excludes internal transfers and foreign-currency rows, but reports the latter", () => {
    const { db, cat, tx } = setup();
    tx("2026-09-12", -20000, { isInternalTransfer: true, categoryId: cat("Interne overboeking") });
    tx("2026-09-13", -1200, { currency: "GBP", categoryId: cat("Vervoer") });
    tx("2026-09-14", -300, { categoryId: cat("Vervoer") });
    const o = getMonthOverview(db, "2026-09");
    expect(o.totals.expenseActual).toBe(300);
    expect(o.foreignCurrencyCount).toBe(1);
  });

  it("tracks income and uncategorised rows, and the net", () => {
    const { db, cat, tx } = setup();
    tx("2026-09-05", 123456, { categoryId: cat("Salaris / bijbaan") });
    tx("2026-09-06", -450);
    tx("2026-09-07", 1000);
    const o = getMonthOverview(db, "2026-09");
    expect(line(o.income, "Salaris / bijbaan").actual).toBe(123456);
    expect(o.uncategorised).toEqual({ expense: 450, income: 1000, count: 2 });
    expect(o.totals).toMatchObject({ incomeActual: 124456, expenseActual: 450, net: 124006 });
  });

  it("total budget: explicit overrides the sum of category budgets", () => {
    const { db, cat, tx } = setup();
    expect(getMonthOverview(db, "2026-09").totals.totalBudget).toBeNull();
    setBudget(db, cat("Huur"), "2026-09", 65000);
    setBudget(db, cat("Boodschappen"), "2026-09", 25000);
    tx("2026-09-01", -65000, { categoryId: cat("Huur") });
    let t = getMonthOverview(db, "2026-09").totals;
    expect(t).toMatchObject({
      totalBudget: 90000,
      totalBudgetIsExplicit: false,
      totalRemaining: 25000,
    });
    setTotalBudget(db, "2026-09", 80000);
    t = getMonthOverview(db, "2026-09").totals;
    expect(t).toMatchObject({
      totalBudget: 80000,
      totalBudgetIsExplicit: true,
      totalRemaining: 15000,
    });
    setTotalBudget(db, "2026-09", null);
    expect(getMonthOverview(db, "2026-09").totals.totalBudgetIsExplicit).toBe(false);
  });
});
