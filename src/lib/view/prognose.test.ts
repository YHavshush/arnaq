import { describe, expect, it } from "vitest";
import type { Forecast, ForecastMonth } from "@/lib/forecast/forecast";
import { buildPrognose } from "./prognose";

const fm = (month: string, kind: ForecastMonth["kind"], low: ForecastMonth["low"] | undefined) =>
  ({
    month,
    kind,
    net: 0,
    cumulativeNet: 0,
    setAside: { actual: 0, planned: 0, total: 0, reserve: 0 },
    cumulativeSetAside: 0,
    cumulativeReserve: 0,
    parts: { income: [], fixed: [] },
    categories: [],
    income: 0,
    expenses: 0,
    ...(low === undefined ? {} : { low }),
  }) as unknown as ForecastMonth;

const forecast = (months: ForecastMonth[]): Forecast =>
  ({
    today: "2026-10-11",
    currentMonth: "2026-10",
    settings: { months: 3, history: 3, pastMonths: 1 },
    variableBasis: { months: [], history: 3, lowConfidence: false, reason: null },
    missed: [],
    openingBalance: 20000,
    openingSavings: null,
    months,
  }) as unknown as Forecast;

describe("buildPrognose: the lowest point in each month", () => {
  it("has no lowest point and no dips for months whose days are not known", () => {
    const p = buildPrognose(
      forecast([fm("2026-10", "mixed", null), fm("2026-11", "forecast", undefined)]),
      "en",
    );
    expect(p.points.map((pt) => pt.low)).toEqual([null, null]);
    expect(p.dipMonths).toBe(0);
  });
});

describe("buildPrognose: when the money runs out", () => {
  const month = (m: string, kind: ForecastMonth["kind"], cumulativeNet: number) =>
    ({
      ...fm(m, kind, undefined),
      cumulativeNet,
      net: 0,
    }) as unknown as ForecastMonth;

  it("is the first month ahead that ends below zero, or null when none does", () => {
    const out = buildPrognose(
      forecast([
        month("2026-10", "mixed", 0),
        month("2026-11", "forecast", -5000),
        month("2026-12", "forecast", -30000),
        month("2027-01", "forecast", -60000),
      ]),
      "en",
    );
    // Opening balance 200.00: October 200, November 150, December -100: it runs out in December.
    expect(out.runsOutIn).toBe("2026-12");
    const fine = buildPrognose(
      forecast([month("2026-10", "mixed", 0), month("2026-11", "forecast", 1000)]),
      "en",
    );
    expect(fine.runsOutIn).toBeNull();
  });

  it("never looks at months that are already real", () => {
    const out = buildPrognose(
      forecast([
        month("2026-09", "actual", -90000),
        month("2026-10", "mixed", 0),
        month("2026-11", "forecast", 1000),
      ]),
      "en",
    );
    expect(out.runsOutIn).toBeNull();
  });
});

describe("buildPrognose: the lowest point counts the savings too", () => {
  const withDays = (
    m: string,
    kind: ForecastMonth["kind"],
    cumulativeNet: number,
    days: number[],
  ) => ({ ...fm(m, kind, null), cumulativeNet, net: 0, days }) as unknown as ForecastMonth;
  const withSavings = (months: ForecastMonth[], savings: number): Forecast =>
    ({ ...forecast(months), openingSavings: savings }) as unknown as Forecast;

  it("is the lowest day of net worth (accounts plus savings), not of the checking accounts alone", () => {
    // Opening 200.00 in the accounts and 500.00 in savings. October ends at 150.00 in the accounts.
    const p = buildPrognose(
      withSavings(
        [
          withDays("2026-10", "mixed", -5000, [20000, 10000, 15000]),
          withDays("2026-11", "forecast", -12000, [14000, -2000, 8000]),
        ],
        50000,
      ),
      "en",
    );
    // October: net worth by day 700, 600, 650. The accounts alone dip to 100, but with savings the low is 600.00.
    expect(p.points[0].low).toEqual({ amount: 60000, date: "2026-10-02" });
    // November: the accounts dip below zero on the 2nd (-20.00), net worth does not (480.00).
    expect(p.points[1].low).toEqual({ amount: 48000, date: "2026-11-02" });
    expect(p.dipMonths).toBe(0);
  });

  it("is a dip when net worth itself goes below zero", () => {
    const p = buildPrognose(
      withSavings([withDays("2026-10", "mixed", -30000, [20000, -5000, -10000])], 0),
      "en",
    );
    expect(p.points[0].low).toEqual({ amount: -10000, date: "2026-10-03" });
    expect(p.dipMonths).toBe(1);
  });
});

describe("buildPrognose: the BTW to set aside is an expense, so growth agrees with net worth", () => {
  const withBtw = (accrued: number) =>
    ({
      ...fm("2026-11", "forecast", undefined),
      income: 96800,
      expenses: 60000,
      net: 36800,
      cumulativeNet: 36800,
      btwAccrued: accrued,
      parts: { income: [], fixed: [] },
      categories: [],
    }) as unknown as ForecastMonth;

  it("adds the BTW accrued to the month's expenses and takes it off its growth, and lists it as a line", () => {
    const p = buildPrognose(forecast([withBtw(16800)]), "en");
    const point = p.points[0];
    expect(point.expenses).toBe(76800);
    expect(point.net).toBe(20000);
    expect(point.btwAccrued).toBe(16800);
    expect(point.expenseParts.total).toBe(76800);
    expect(point.expenseParts.lines.at(-1)).toMatchObject({ key: "btw", amount: 16800 });
  });

  it("leaves the net worth line as it was: the BTW was already taken off there", () => {
    const without = buildPrognose(forecast([withBtw(0)]), "en").points[0];
    const accrued = withBtw(16800);
    // The forecast's own btwWorth already carries the accrual (cumulative uses it), so only expenses and net move.
    const p = buildPrognose(forecast([{ ...accrued, btwWorth: -16800 } as ForecastMonth]), "en")
      .points[0];
    expect(p.cumulative - without.cumulative).toBe(-16800);
  });

  it("changes nothing for a month with no BTW to set aside", () => {
    const point = buildPrognose(forecast([withBtw(0)]), "en").points[0];
    expect(point.expenses).toBe(60000);
    expect(point.net).toBe(36800);
    expect(point.expenseParts.lines.some((l) => l.key === "btw")).toBe(false);
  });
});
