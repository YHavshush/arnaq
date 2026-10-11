import { describe, expect, it } from "vitest";
import { getMonthOverview } from "@/lib/budget/overview";
import { setup } from "@/lib/recurring/test-utils";
import { ForecastError } from "./errors";
import { getForecast } from "./forecast";

const monthsOf = (f: ReturnType<typeof getForecast>) => f.months.map((m) => m.month);
const kindsOf = (f: ReturnType<typeof getForecast>) => f.months.map((m) => m.kind);

describe("getForecast: options and timeline", () => {
  it("defaults to 3 past months, the current month and 6 months ahead", () => {
    const { db } = setup();
    const f = getForecast(db, { today: "2026-10-11" });
    expect(f.currentMonth).toBe("2026-10");
    expect(f.settings).toEqual({ months: 6, history: 3, pastMonths: 3 });
    expect(monthsOf(f)).toEqual([
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
    ]);
  });

  it("rolls over the year end", () => {
    const { db } = setup();
    const f = getForecast(db, { today: "2026-12-31", months: 2, pastMonths: 2 });
    expect(monthsOf(f)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    const jan = getForecast(db, { today: "2027-01-01", months: 1, pastMonths: 1 });
    expect(monthsOf(jan)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("handles today on the 31st without skipping short months", () => {
    const { db } = setup();
    const f = getForecast(db, { today: "2026-01-31", months: 2, pastMonths: 0 });
    expect(monthsOf(f)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("supports horizons 1 and 36", () => {
    const { db } = setup();
    expect(monthsOf(getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 0 }))).toEqual([
      "2026-10",
      "2026-11",
    ]);
    const long = getForecast(db, { today: "2026-10-11", months: 36, pastMonths: 0 });
    expect(long.months).toHaveLength(37);
    expect(long.months.at(-1)!.month).toBe("2029-10");
  });

  it("rejects invalid options with a ForecastError", () => {
    const { db } = setup();
    const bad = [
      { today: "2026-10-32" },
      { today: "11-10-2026" },
      { today: "2026-10-11", months: 0 },
      { today: "2026-10-11", months: 37 },
      { today: "2026-10-11", months: 1.5 },
      { today: "2026-10-11", months: Number.NaN },
      { today: "2026-10-11", history: 0 },
      { today: "2026-10-11", history: 13 },
      { today: "2026-10-11", pastMonths: -1 },
      { today: "2026-10-11", pastMonths: 13 },
    ];
    for (const opts of bad)
      expect(() => getForecast(db, opts), JSON.stringify(opts)).toThrow(ForecastError);
  });
});

describe("getForecast: month kinds and actuals", () => {
  it("marks uploaded past months actual, others no-data, now mixed and later forecast", () => {
    const { db, cover } = setup();
    cover("2026-08");
    const f = getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 2 });
    expect(kindsOf(f)).toEqual(["actual", "no-data", "mixed", "forecast"]);
    expect(f.months.map((m) => m.hasUpload)).toEqual([true, false, false, false]);
    cover("2026-10");
    expect(
      getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 2 }).months[2],
    ).toMatchObject({ kind: "mixed", hasUpload: true });
  });

  it("reports actual months on exactly the month overview basis", () => {
    const { db, tx, cover, cat } = setup();
    cover("2026-09");
    tx("2026-09-01", -65000, { categoryId: cat("Huur") });
    tx("2026-09-03", -4237, { categoryId: cat("Boodschappen") });
    tx("2026-09-04", 500, { categoryId: cat("Boodschappen") }); // refund
    tx("2026-09-05", 123456, { categoryId: cat("Salaris / bijbaan") });
    tx("2026-09-06", -450); // uncategorised
    tx("2026-09-07", -20000, { isInternalTransfer: true });
    tx("2026-09-08", -1200, { currency: "GBP", categoryId: cat("Vervoer") });
    const f = getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 1 });
    const sep = f.months[0];
    const o = getMonthOverview(db, "2026-09");
    expect(sep).toMatchObject({
      kind: "actual",
      income: o.totals.incomeActual,
      expenses: o.totals.expenseActual,
      net: o.totals.net,
      actual: { income: 123456, expenses: 65000 + 3737 + 450 },
      variable: 0,
      recurring: { income: 0, expenses: 0 },
    });
    const line = (name: string) => sep.categories.find((c) => c.name === name)!;
    expect(line("Boodschappen")).toMatchObject({
      actual: 3737,
      recurring: 0,
      variable: 0,
      total: 3737,
    });
    expect(sep.categories.at(-1)).toMatchObject({ categoryId: null, actual: 450, total: 450 });
  });

  it("keeps no-data months at zero even when stray transactions fall in them", () => {
    const { db, tx, cat } = setup();
    tx("2026-09-30", -5000, { categoryId: cat("Overig") }); // from a CSV labelled October, say
    const f = getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 1 });
    expect(f.months[0]).toMatchObject({ kind: "no-data", income: 0, expenses: 0, net: 0 });
    expect(f.months[0].categories.every((c) => c.total === 0)).toBe(true);
  });
});
