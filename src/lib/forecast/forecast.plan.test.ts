import { describe, expect, it } from "vitest";
import { schema } from "@/db";
import { btwShareForMonth } from "@/lib/btw/share";
import { getBudgetsByMonth, setBudget } from "@/lib/budget/budgets";
import { setPlanOverride } from "@/lib/plan/overrides";
import { setup } from "@/lib/recurring/test-utils";
import { buildPrognose } from "@/lib/view/prognose";
import { getForecast, type Forecast, type ForecastMonth } from "./forecast";

const TODAY = "2026-11-02";

const at = (f: Forecast, month: string) => f.months.find((m) => m.month === month)!;
const cat = (m: ForecastMonth, id: number | null) => m.categories.find((c) => c.categoryId === id)!;
const sources = (m: ForecastMonth) => {
  const s = m.expenseSources;
  return s.fixed + s.budgets + s.averages + s.typed;
};

/**
 * August to October uploaded: groceries 300 a month, other 100 a month, the bank's balance after each. Rent 1,000 on the
 * 1st and the client's invoice of 2,420.00 on the 25th (BTW inside it: 420.00) are fixed items from November on.
 * Today is 2 November; the rent for November is not paid yet.
 */
async function world() {
  const s = await setup();
  const groceries = await s.cat("Boodschappen");
  const other = await s.cat("Overig");
  await s.cover("2026-08", "2026-09", "2026-10");
  let balance = 400000;
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    balance -= 30000;
    await s.tx(`${month}-10`, -30000, { categoryId: groceries, balanceAfter: balance });
    balance -= 10000;
    await s.tx(`${month}-12`, -10000, { categoryId: other, balanceAfter: balance });
  }
  // A real day today, so the current month's low can be simulated from it.
  await s.tx("2026-11-02", -100, { categoryId: other, balanceAfter: balance - 100 });
  const rent = await s.addItem({
    name: "Huur",
    matchCounterparty: "Verhuurder",
    expectedAmount: 100000,
    dayOfMonth: 1,
    startDate: "2026-11-01",
    categoryId: await s.cat("Huur"),
  });
  const invoice = await s.addItem({
    name: "Featurn invoice",
    type: "income",
    matchCounterparty: "Featurn B.V.",
    expectedAmount: 242000,
    dayOfMonth: 25,
    startDate: "2026-11-01",
    categoryId: await s.cat("Salaris / bijbaan"),
  });
  const forecast = (basis: "averages" | "budget" | "own" = "averages", ownSpending?: number) =>
    getForecast(s.db, { today: TODAY, months: 6, pastMonths: 1, basis, ownSpending });
  const type = (
    kind: "category" | "item",
    id: number,
    month: string,
    amount: number | null,
    scope: "month" | "after" = "month",
  ) => setPlanOverride(s.db, { kind, id, month, amount, scope }, TODAY);
  return { ...s, groceries, other, rent, invoice, forecast, type };
}

describe("getForecast: a typed fixed item amount", () => {
  it("a rent change from March lowers March onwards only", async () => {
    const w = await world();
    const before = await w.forecast();
    await w.type("item", w.rent.id, "2027-03", 90000, "after");
    const after = await w.forecast();
    for (const month of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"])
      expect(at(after, month).expenses, month).toBe(at(before, month).expenses);
    for (const month of ["2027-03", "2027-04", "2027-05"]) {
      const m = at(after, month);
      expect(m.expenses, month).toBe(at(before, month).expenses - 10000);
      expect(m.recurring.expenses).toBe(90000);
      expect(m.parts.fixed).toMatchObject([{ name: "Huur", amount: 90000, settled: false }]);
      expect(m.expenseSources.fixed).toBe(90000);
      expect(sources(m)).toBe(m.expenses);
    }
  });

  it("the lowest point follows the typed amount", async () => {
    const w = await world();
    const before = await w.forecast();
    await w.type("item", w.rent.id, "2027-01", 150000);
    const after = await w.forecast();
    // December is untouched; January's low (rent on the 1st, before the income) is 500 lower, and every month after
    // starts 500 lower.
    expect(at(after, "2026-12").low).toEqual(at(before, "2026-12").low);
    expect(at(after, "2027-01").low!.amount).toBe(at(before, "2027-01").low!.amount - 50000);
    expect(at(after, "2027-02").low!.amount).toBe(at(before, "2027-02").low!.amount - 50000);
  });

  it("a typed income changes the income, the BTW accrued and the net worth line", async () => {
    const w = await world();
    const before = await w.forecast();
    await w.type("item", w.invoice.id, "2026-12", 121000);
    const after = await w.forecast();
    const dec = at(after, "2026-12");
    expect(dec.income).toBe(121000);
    expect(dec.parts.income).toMatchObject([{ name: "Featurn invoice", amount: 121000 }]);
    expect(dec.btwAccrued).toBe(21000);
    expect(at(after, "2027-01").btwAccrued).toBe(42000);
    // Net worth in December: 1,210 less income, but 210 less BTW owed on it.
    const p0 = buildPrognose(before, "en").points;
    const p1 = buildPrognose(after, "en").points;
    const i = p1.findIndex((p) => p.month === "2026-12");
    expect(p1[i - 1].cumulative).toBe(p0[i - 1].cumulative);
    expect(p1[i].cumulative).toBe(p0[i].cumulative - 121000 + 21000);
    expect(p1.at(-1)!.cumulative).toBe(p0.at(-1)!.cumulative - 100000);
  });

  it("the BTW share of a month (the Today taxes budget) follows a typed income", async () => {
    const w = await world();
    await w.type("item", w.invoice.id, "2026-11", 363000);
    expect(await btwShareForMonth(w.db, { month: "2026-11", today: TODAY })).toMatchObject({
      expected: 363000,
      share: 63000,
    });
    const taxes = await w.cat("Belastingen");
    const budgets = await getBudgetsByMonth(w.db, "2026-11", "2026-11", { btw: { today: TODAY } });
    expect(budgets.get("2026-11")!.btw.get(taxes)).toBe(63000);
  });

  it("the current month: a still expected item takes the typed amount, a paid one keeps the real amount", async () => {
    const w = await world();
    await w.type("item", w.invoice.id, "2026-11", 200000);
    await w.type("item", w.rent.id, "2026-11", 1);
    // The rent for November was paid on the 1st (matched in memory): real money is never overridden.
    await w.tx("2026-11-01", -100000, { counterparty: "Verhuurder" });
    const nov = at(await w.forecast(), "2026-11");
    expect(nov.kind).toBe("mixed");
    expect(nov.parts.fixed).toMatchObject([{ name: "Huur", amount: 100000, settled: true }]);
    expect(nov.parts.income).toMatchObject([{ amount: 200000, settled: false }]);
    expect(nov.btwAccrued).toBe(Math.round((200000 * 21) / 121));
  });

  it("a typed amount of a past month is ignored", async () => {
    const w = await world();
    const before = await w.forecast();
    // Written straight into the table: the API refuses past months, but an old row must not change anything either.
    await w.db.insert(schema.planOverrides).values([
      { itemId: w.rent.id, month: "2026-10", amount: 1 },
      { categoryId: w.groceries, month: "2026-10", amount: 999999 },
    ]);
    const after = await w.forecast();
    expect(after.months).toEqual(before.months);
  });
});

describe("getForecast: a typed category amount", () => {
  it("replaces the category's everyday spending for that month, whatever the basis, and not its fixed items", async () => {
    const w = await world();
    await w.type("category", w.groceries, "2026-12", 50000);
    await w.type("category", await w.cat("Huur"), "2026-12", 7000);
    await setBudget(w.db, w.groceries, "2026-12", 10000);
    for (const [basis, own] of [["averages"], ["budget"], ["own", 80000]] as const) {
      const f = await w.forecast(basis, own);
      const dec = at(f, "2026-12");
      expect(cat(dec, w.groceries), basis).toMatchObject({
        variableAverage: 50000,
        variable: 50000,
      });
      // Rent keeps its fixed item and gets the typed everyday amount on top.
      expect(cat(dec, await w.cat("Huur"))).toMatchObject({ recurring: 100000, variable: 7000 });
      expect(dec.expenseSources.typed).toBe(57000);
      expect(dec.expenseSources.fellBack).not.toContain("Boodschappen");
      expect(sources(dec)).toBe(dec.expenses);
      // January is not typed: it is the suggestion again.
      expect(cat(at(f, "2027-01"), w.groceries).variable).not.toBe(50000);
    }
  });

  it("the current month: the typed amount is the month's everyday spending, less what is already spent", async () => {
    const w = await world();
    await w.tx("2026-11-01", -12000, { categoryId: w.groceries });
    await w.type("category", w.groceries, "2026-11", 40000);
    const nov = at(await w.forecast(), "2026-11");
    expect(cat(nov, w.groceries)).toMatchObject({
      actual: 12000,
      variableAverage: 40000,
      variable: 28000,
    });
    expect(nov.expenseSources.typed).toBe(28000);
    expect(nov.actual.expenses + sources(nov)).toBe(nov.expenses);
  });

  it("without anything typed the sources have typed 0", async () => {
    const w = await world();
    const f = await w.forecast();
    for (const m of f.months) expect(m.expenseSources.typed).toBe(0);
  });
});
