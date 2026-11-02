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
  it("puts each month's low on its point and counts the months that dip below zero", () => {
    const p = buildPrognose(
      forecast([
        fm("2026-09", "actual", { amount: 20000, date: "2026-09-05" }),
        fm("2026-10", "mixed", { amount: -1, date: "2026-10-03" }),
        fm("2026-11", "forecast", { amount: 0, date: "2026-11-03" }),
        fm("2026-12", "forecast", { amount: -42600, date: "2026-12-03" }),
        fm("2027-01", "forecast", null),
      ]),
      "en",
    );
    expect(p.points.map((pt) => pt.low)).toEqual([
      { amount: 20000, date: "2026-09-05" },
      { amount: -1, date: "2026-10-03" },
      { amount: 0, date: "2026-11-03" },
      { amount: -42600, date: "2026-12-03" },
      null,
    ]);
    // Zero is not below zero; an unknown low is not a dip.
    expect(p.dipMonths).toBe(2);
  });

  it("no dips when nothing goes below zero or nothing is known", () => {
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
