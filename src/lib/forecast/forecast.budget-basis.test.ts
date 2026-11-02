import { describe, expect, it } from "vitest";
import { getBudgetsByMonth, setBudget } from "@/lib/budget/budgets";
import { setup } from "@/lib/recurring/test-utils";
import { getForecast, type Forecast, type ForecastMonth } from "./forecast";

const TODAY = "2026-10-11";

const at = (f: Forecast, month: string) => f.months.find((m) => m.month === month)!;
const cat = (m: ForecastMonth, id: number | null) => m.categories.find((c) => c.categoryId === id)!;

/**
 * History: July, August and September uploaded. Groceries 900 a month, Other 200 a month, uncategorised 30 a month.
 * Rent 800 on the 1st is a fixed item from October on.
 */
async function world() {
  const s = await setup();
  const groceries = await s.cat("Boodschappen");
  const other = await s.cat("Overig");
  const rent = await s.cat("Huur");
  await s.cover("2026-07", "2026-08", "2026-09");
  for (const month of ["2026-07", "2026-08", "2026-09"]) {
    await s.tx(`${month}-10`, -90000, { categoryId: groceries });
    await s.tx(`${month}-12`, -20000, { categoryId: other });
    await s.tx(`${month}-14`, -3000);
  }
  await s.addItem({
    name: "Huur",
    matchCounterparty: "Verhuurder",
    expectedAmount: 80000,
    dayOfMonth: 1,
    startDate: "2026-10-01",
    categoryId: rent,
  });
  const forecast = (basis: "averages" | "budget" | "own" = "budget", ownSpending?: number) =>
    getForecast(s.db, { today: TODAY, months: 4, pastMonths: 1, basis, ownSpending });
  return { ...s, groceries, other, rent, forecast };
}

describe("getForecast, basis budget: a typed budget carries forward", () => {
  it("a month without a typed budget uses the most recent earlier month's", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    const f = await w.forecast();
    // Typed for November only: December, January and February use November's 400 instead of the 900 average.
    for (const month of ["2026-11", "2026-12", "2027-01", "2027-02"]) {
      expect(cat(at(f, month), w.groceries)).toMatchObject({ variable: 40000, budget: 40000 });
    }
    // October (before anything was typed) still uses the average.
    expect(cat(at(f, "2026-10"), w.groceries).variableAverage).toBe(90000);
  });

  it("a newly typed budget takes over from then on", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    await setBudget(w.db, w.groceries, "2027-01", 30000);
    const f = await w.forecast();
    expect(
      ["2026-11", "2026-12", "2027-01", "2027-02"].map((m) => cat(at(f, m), w.groceries).variable),
    ).toEqual([40000, 40000, 30000, 30000]);
  });

  it("carries a budget typed before the months shown into the current month and beyond", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-06", 50000);
    const f = await w.forecast();
    // October is the current month: what is left of 500 after nothing spent yet.
    expect(cat(at(f, "2026-10"), w.groceries)).toMatchObject({
      variableAverage: 50000,
      budget: 50000,
    });
    expect(cat(at(f, "2027-02"), w.groceries).variable).toBe(50000);
  });

  it("leaves months before the current month untouched", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-06", 50000);
    const f = await w.forecast();
    // September is a real month: nothing was typed for it, so it has no budget.
    expect(at(f, "2026-09").kind).toBe("actual");
    expect(cat(at(f, "2026-09"), w.groceries).budget).toBeNull();
  });

  it("a typed amount of zero carries forward as zero", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 0);
    const f = await w.forecast();
    expect(cat(at(f, "2027-01"), w.groceries)).toMatchObject({ budget: 0, variable: 0 });
  });

  it("the fixed items stay the floor of the month they are scheduled in", async () => {
    const w = await world();
    // 500 typed for rent in October: less than the 800 rent, so the rent is the budget, and nothing is variable.
    await setBudget(w.db, w.rent, "2026-10", 50000);
    const f = await w.forecast();
    expect(cat(at(f, "2026-12"), w.rent)).toMatchObject({
      budget: 80000,
      recurring: 80000,
      variable: 0,
    });
  });

  it("a carried budget above the fixed items leaves the difference as everyday spending", async () => {
    const w = await world();
    await setBudget(w.db, w.rent, "2026-10", 100000);
    const f = await w.forecast();
    expect(cat(at(f, "2027-01"), w.rent)).toMatchObject({
      budget: 100000,
      recurring: 80000,
      variable: 20000,
    });
  });

  it("a carried budget does not carry the fixed items of its own month", async () => {
    const w = await world();
    // A quarterly item only in November: November's budget floor is 600, December has no floor from it.
    await w.addItem({
      name: "Quarterly",
      matchCounterparty: "Gemeente",
      expectedAmount: 60000,
      dayOfMonth: 15,
      frequency: "quarterly",
      startDate: "2026-11-01",
      categoryId: w.other,
    });
    await setBudget(w.db, w.other, "2026-10", 10000);
    const f = await w.forecast();
    expect(cat(at(f, "2026-11"), w.other)).toMatchObject({ budget: 60000, variable: 0 });
    expect(cat(at(f, "2026-12"), w.other)).toMatchObject({ budget: 10000, variable: 10000 });
  });

  it("does not carry anything with the averages basis (the forecast never invents a budget there)", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    const f = await w.forecast("averages");
    expect(cat(at(f, "2026-12"), w.groceries)).toMatchObject({ budget: null, variable: 90000 });
  });

  it("the budget screens still see only what was typed for each month", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    await w.forecast();
    const b = await getBudgetsByMonth(w.db, "2026-11", "2026-12");
    expect(b.get("2026-11")?.byCategory.get(w.groceries)).toBe(40000);
    expect(b.get("2026-12")?.byCategory.get(w.groceries)).toBeUndefined();
  });

  it("can report where a carried budget came from", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    const b = await getBudgetsByMonth(w.db, "2026-10", "2027-01", { carryForwardFrom: "2026-10" });
    expect(b.get("2026-11")?.carriedFrom.get(w.groceries)).toBeUndefined();
    expect(b.get("2026-12")?.carriedFrom.get(w.groceries)).toBe("2026-11");
    expect(b.get("2027-01")?.byCategory.get(w.groceries)).toBe(40000);
    expect(b.get("2026-10")?.byCategory.get(w.groceries)).toBeUndefined();
  });
});

describe("getForecast: what a month's expected expenses are made of (expenseSources)", () => {
  it("splits a forecast month into fixed items, budgets and averages, and names the categories that fell back", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    const f = await w.forecast();
    for (const month of ["2026-11", "2026-12", "2027-01"]) {
      const m = at(f, month);
      expect(m.expenseSources).toEqual({
        fixed: 80000,
        budgets: 40000,
        // Other (200) and uncategorised (30) have no budget: they use their average.
        averages: 23000,
        typed: 0,
        fellBack: ["Overig"],
      });
      expect(m.expenseSources.fixed + m.expenseSources.budgets + m.expenseSources.averages).toBe(
        m.expenses,
      );
    }
  });

  it("with the averages basis everything everyday is an average and nothing fell back", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-11", 40000);
    const m = at(await w.forecast("averages"), "2026-12");
    expect(m.expenseSources).toEqual({
      fixed: 80000,
      budgets: 0,
      averages: 113000,
      typed: 0,
      fellBack: [],
    });
    expect(m.expenseSources.fixed + m.expenseSources.averages).toBe(m.expenses);
  });

  it("with the own basis the typed amount counts as averages (it is shared out like them)", async () => {
    const w = await world();
    const m = at(await w.forecast("own", 50000), "2026-12");
    expect(m.expenseSources).toMatchObject({
      fixed: 80000,
      budgets: 0,
      averages: 50000,
      fellBack: [],
    });
  });

  it("the current month: what is already spent is not in the sources; the sources are what is still expected", async () => {
    const w = await world();
    await setBudget(w.db, w.groceries, "2026-10", 40000);
    // Spent so far in October: 150 groceries, 50 other, 800 rent (not matched to the item: it stays expected too).
    await w.cover("2026-10");
    await w.tx("2026-10-05", -15000, { categoryId: w.groceries });
    await w.tx("2026-10-06", -5000, { categoryId: w.other });
    const f = await w.forecast();
    const oct = at(f, "2026-10");
    expect(oct.kind).toBe("mixed");
    expect(oct.expenseSources).toEqual({
      fixed: 80000,
      // What is left of the 400 budget after 150, and of the 200 average after 50, plus the uncategorised 30.
      budgets: 25000,
      averages: 15000 + 3000,
      typed: 0,
      fellBack: ["Overig"],
    });
    expect(oct.actual.expenses).toBe(20000);
    expect(
      oct.actual.expenses +
        oct.expenseSources.fixed +
        oct.expenseSources.budgets +
        oct.expenseSources.averages,
    ).toBe(oct.expenses);
  });

  it("a category without a budget and without any average is not named as fallen back", async () => {
    const w = await world();
    const m = at(await w.forecast(), "2026-12");
    // Nothing typed at all: groceries and other fall back; the categories with a 0 average are not worth naming.
    expect(m.expenseSources.fellBack).toEqual(["Boodschappen", "Overig"]);
    expect(m.expenseSources.budgets).toBe(0);
  });

  it("a category whose budget is only its fixed items is a budget, not a fallback", async () => {
    const w = await world();
    const m = at(await w.forecast(), "2026-12");
    expect(m.expenseSources.fellBack).not.toContain("Huur");
  });

  it("real months have no sources", async () => {
    const w = await world();
    const sep = at(await w.forecast(), "2026-09");
    expect(sep.kind).toBe("actual");
    expect(sep.expenseSources).toEqual({
      fixed: 0,
      budgets: 0,
      averages: 0,
      typed: 0,
      fellBack: [],
    });
  });
});
