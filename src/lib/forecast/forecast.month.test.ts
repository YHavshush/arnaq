import { describe, expect, it } from "vitest";
import { setBudget, setTotalBudget } from "@/lib/budget/budgets";
import { matchOccurrences } from "@/lib/recurring/matching";
import { generateOccurrences } from "@/lib/recurring/occurrences";
import { setup } from "@/lib/recurring/test-utils";
import { getForecast, type ForecastMonth } from "./forecast";

const line = (m: ForecastMonth, name: string | null) =>
  m.categories.find((c) => (name === null ? c.categoryId === null : c.name === name))!;

/**
 * History: August and September uploaded. Boodschappen 300 + 400 (avg 350), Eten & drinken
 * 50 + 50 (avg 50), uncategorised 0 + 20 (avg 10). From October: rent 800 on the 1st,
 * Spotify 9,99 on the 20th, salary 2500 on the 25th.
 */
function scenario() {
  const s = setup();
  const { tx, cover, cat, addItem } = s;
  cover("2026-08", "2026-09");
  tx("2026-08-05", -30000, { categoryId: cat("Boodschappen") });
  tx("2026-09-05", -40000, { categoryId: cat("Boodschappen") });
  tx("2026-08-06", -5000, { categoryId: cat("Eten & drinken") });
  tx("2026-09-06", -5000, { categoryId: cat("Eten & drinken") });
  tx("2026-09-07", -2000);
  addItem({
    name: "Huur",
    matchCounterparty: "Verhuurder",
    expectedAmount: 80000,
    dayOfMonth: 1,
    startDate: "2026-10-01",
    categoryId: cat("Huur"),
  });
  addItem({ startDate: "2026-10-01", dayOfMonth: 20, categoryId: cat("Abonnementen") });
  addItem({
    name: "Salaris",
    type: "income",
    matchCounterparty: "Werkgever",
    expectedAmount: 250000,
    dayOfMonth: 25,
    startDate: "2026-10-01",
    categoryId: cat("Salaris / bijbaan"),
  });
  return s;
}

/** October uploaded so far: rent paid (matched), groceries 120, eating out 70. */
function uploadOctober(s: ReturnType<typeof scenario>) {
  const { db, tx, cover, cat } = s;
  cover("2026-10");
  generateOccurrences(db, { throughMonth: "2026-10" });
  tx("2026-10-01", -80000, { counterparty: "Verhuurder", categoryId: cat("Huur") });
  tx("2026-10-05", -12000, { categoryId: cat("Boodschappen") });
  tx("2026-10-06", -7000, { categoryId: cat("Eten & drinken") });
  expect(matchOccurrences(db).matched).toBe(1);
}

describe("getForecast: the current month mixes actual and expected", () => {
  it("adds still-expected recurring and the remaining variable spend to the actuals", () => {
    const s = scenario();
    uploadOctober(s);
    const [oct] = getForecast(s.db, { today: "2026-10-11", months: 1, pastMonths: 0 }).months;
    expect(oct).toMatchObject({ kind: "mixed", hasUpload: true });
    expect(line(oct, "Boodschappen")).toMatchObject({
      actual: 12000,
      recurring: 0,
      variableAverage: 35000,
      variable: 23000,
      total: 35000,
    });
    // Already above its average: nothing more expected, the actual stays.
    expect(line(oct, "Eten & drinken")).toMatchObject({ actual: 7000, variable: 0, total: 7000 });
    expect(line(oct, "Huur")).toMatchObject({ actual: 80000, recurring: 0, variable: 0 });
    expect(line(oct, "Abonnementen")).toMatchObject({ actual: 0, recurring: 999, total: 999 });
    expect(line(oct, null)).toMatchObject({ actual: 0, variable: 1000, total: 1000 });
    expect(oct).toMatchObject({
      actual: { income: 0, expenses: 99000 },
      recurring: { income: 250000, expenses: 999 },
      variable: 24000,
      income: 250000,
      expenses: 99000 + 999 + 24000,
      net: 250000 - 123999,
    });
  });

  it("without an upload projects the full averages and every recurring payment", () => {
    const s = scenario();
    const [oct] = getForecast(s.db, { today: "2026-10-11", months: 1, pastMonths: 0 }).months;
    expect(oct).toMatchObject({ kind: "mixed", hasUpload: false });
    expect(line(oct, "Boodschappen")).toMatchObject({ actual: 0, variable: 35000 });
    expect(oct).toMatchObject({
      recurring: { income: 250000, expenses: 80999 },
      variable: 41000,
      expenses: 121999,
    });
  });

  it("projects future months from recurring items plus average variable spend", () => {
    const s = scenario();
    uploadOctober(s);
    const f = getForecast(s.db, { today: "2026-10-11", months: 2, pastMonths: 0 });
    for (const m of f.months.slice(1)) {
      expect(m).toMatchObject({
        kind: "forecast",
        actual: { income: 0, expenses: 0 },
        recurring: { income: 250000, expenses: 80999 },
        variable: 41000,
        income: 250000,
        expenses: 121999,
        net: 128001,
      });
      expect(line(m, "Eten & drinken")).toMatchObject({ variable: 5000, total: 5000 });
    }
    expect(f.variableBasis).toEqual({
      months: ["2026-08", "2026-09"],
      history: 3,
      lowConfidence: true,
      reason: "Only 2 of 3 requested months of history are uploaded.",
    });
  });
});

describe("getForecast: budget comparison and chart totals", () => {
  it("compares with the month's budget and never invents one", () => {
    const s = scenario();
    const { db, cat } = s;
    setBudget(db, cat("Boodschappen"), "2026-09", 25000); // a past month without upload
    setBudget(db, cat("Boodschappen"), "2026-10", 30000);
    setBudget(db, cat("Huur"), "2026-10", 80000);
    setTotalBudget(db, "2026-12", 150000);
    const f = getForecast(db, { today: "2026-10-11", months: 2, pastMonths: 1, history: 1 });
    const [sep, oct, nov, dec] = f.months;

    expect(sep.kind).toBe("actual");
    expect(sep.budget).toEqual({ total: 25000, isExplicit: false, difference: 25000 - 47000 });

    expect(oct.budget).toEqual({
      total: 110000,
      isExplicit: false,
      difference: 110000 - oct.expenses,
    });
    expect(line(oct, "Boodschappen")).toMatchObject({
      budget: 30000,
      total: 40000,
      difference: -10000,
    });
    expect(line(oct, "Huur")).toMatchObject({ budget: 80000, total: 80000, difference: 0 });
    expect(line(oct, "Overig")).toMatchObject({ budget: null, difference: null });

    expect(nov.budget).toEqual({ total: null, isExplicit: false, difference: null });
    expect(nov.categories.every((c) => c.budget === null && c.difference === null)).toBe(true);

    expect(dec.budget).toEqual({
      total: 150000,
      isExplicit: true,
      difference: 150000 - dec.expenses,
    });
  });

  it("reports budgets of no-data months without a difference", () => {
    const { db, cat } = setup();
    setBudget(db, cat("Boodschappen"), "2026-09", 25000);
    const [sep] = getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 1 }).months;
    expect(sep.kind).toBe("no-data");
    expect(sep.budget).toEqual({ total: 25000, isExplicit: false, difference: null });
    expect(line(sep, "Boodschappen")).toMatchObject({ budget: 25000, difference: null });
  });

  it("keeps a running cumulative net over the returned months", () => {
    const s = scenario();
    uploadOctober(s);
    const f = getForecast(s.db, { today: "2026-10-11", months: 3, pastMonths: 3 });
    let running = 0;
    for (const m of f.months) {
      running += m.net;
      expect(m.cumulativeNet).toBe(running);
      expect(m.net).toBe(m.income - m.expenses);
      expect(m.expenses).toBe(m.categories.reduce((sum, c) => sum + c.total, 0));
    }
    expect(f.months[0]).toMatchObject({ kind: "no-data", cumulativeNet: 0 });
  });
});
