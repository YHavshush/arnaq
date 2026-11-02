import { describe, expect, it } from "vitest";
import { lowestDay, simulateDays, type FixedMove } from "./low";

const out = (date: string, amount: number, name = "cost"): FixedMove => ({
  type: "expense",
  amount,
  date,
  name,
});
const inc = (date: string, amount: number, name = "pay"): FixedMove => ({
  type: "income",
  amount,
  date,
  name,
});

describe("simulateDays", () => {
  it("dips before the income lands (the owner's example)", () => {
    // November has 30 days: 20 a day is 600 for the month (low enough that the month itself ends in the plus).
    const series = simulateDays({
      month: "2026-11",
      start: 30000,
      moves: [out("2026-11-01", 63200, "rent"), inc("2026-11-04", 96800), inc("2026-11-05", 50000)],
      variable: 60000,
    });
    expect(series).toHaveLength(30);
    expect(series.slice(0, 5)).toEqual([
      30000 - 63200 - 2000,
      30000 - 63200 - 4000,
      30000 - 63200 - 6000,
      30000 - 63200 + 96800 - 8000,
      30000 - 63200 + 96800 + 50000 - 10000,
    ]);
    expect(series.at(-1)).toBe(30000 - 63200 + 96800 + 50000 - 60000);
    expect(lowestDay("2026-11", 1, series)).toEqual({ amount: -39200, date: "2026-11-03" });
  });

  it("with about 70 a day the same month keeps falling after the income: the low is the last day", () => {
    const series = simulateDays({
      month: "2026-11",
      start: 30000,
      moves: [out("2026-11-01", 63200, "rent"), inc("2026-11-04", 96800), inc("2026-11-05", 50000)],
      variable: 210000,
    });
    expect(series[2]).toBe(30000 - 63200 - 21000);
    expect(lowestDay("2026-11", 1, series)).toEqual({
      amount: 30000 - 63200 + 146800 - 210000,
      date: "2026-11-30",
    });
  });

  it("does not dip when the balance is comfortable: the low is still the lowest end of day", () => {
    const series = simulateDays({
      month: "2026-11",
      start: 500000,
      moves: [out("2026-11-01", 63200), inc("2026-11-04", 96800)],
      variable: 30000,
    });
    const low = lowestDay("2026-11", 1, series)!;
    expect(low.amount).toBeGreaterThan(0);
    expect(low).toEqual({ amount: 500000 - 63200 - 3000, date: "2026-11-03" });
  });

  it("spreads the variable spending evenly and to the exact cent over the month", () => {
    const series = simulateDays({ month: "2026-11", start: 0, moves: [], variable: 10000 });
    // 10000 over 30 days: the running total is rounded per day, so it ends exactly on the month's amount.
    expect(series.at(-1)).toBe(-10000);
    const perDay = series.map((b, i) => (i === 0 ? -b : (series[i - 1] ?? 0) - b));
    for (const d of perDay) expect([333, 334]).toContain(d);
    expect(perDay.reduce((s, d) => s + d, 0)).toBe(10000);
  });

  it("ends on start + income - costs - variable, so the next month can start from it", () => {
    const series = simulateDays({
      month: "2027-01",
      start: 12345,
      moves: [out("2027-01-01", 80000), inc("2027-01-25", 250000), out("2027-01-31", 999)],
      variable: 41000,
    });
    expect(series).toHaveLength(31);
    expect(series.at(-1)).toBe(12345 - 80000 + 250000 - 999 - 41000);
  });

  it("income on the 31st in a short month lands on the last day, not lost", () => {
    // A stored date outside the month (a 31st carried into February) is pulled onto the last day.
    const series = simulateDays({
      month: "2027-02",
      start: 10000,
      moves: [inc("2027-02-31", 100000), out("2027-02-01", 50000)],
      variable: 0,
    });
    expect(series).toHaveLength(28);
    expect(series[26]).toBe(10000 - 50000);
    expect(series[27]).toBe(10000 - 50000 + 100000);
    expect(lowestDay("2027-02", 1, series)).toEqual({ amount: -40000, date: "2027-02-01" });
  });

  it("from a day in the month: earlier-dated moves land on that day and the variable is spread over the days left", () => {
    // Today is the 21st of November: 10 days left. Rent was due on the 1st and is still expected.
    const series = simulateDays({
      month: "2026-11",
      start: 70000,
      fromDay: 21,
      moves: [out("2026-11-01", 63200), out("2026-10-28", 1000), inc("2026-11-25", 96800)],
      variable: 10000,
    });
    expect(series).toHaveLength(10);
    expect(series[0]).toBe(70000 - 63200 - 1000 - 1000);
    expect(series.at(-1)).toBe(70000 - 63200 - 1000 + 96800 - 10000);
  });

  it("costs and income on the same day net out by the end of that day", () => {
    const series = simulateDays({
      month: "2026-11",
      start: 1000,
      moves: [out("2026-11-10", 5000), inc("2026-11-10", 5000)],
      variable: 0,
    });
    expect(Math.min(...series)).toBe(1000);
  });
});

describe("lowestDay", () => {
  it("takes the first day when the lowest balance repeats", () => {
    expect(lowestDay("2026-11", 1, [5, 3, 3, 4])).toEqual({ amount: 3, date: "2026-11-02" });
  });
  it("counts days from the first day given", () => {
    expect(lowestDay("2026-11", 9, [5, 3])).toEqual({ amount: 3, date: "2026-11-10" });
  });
  it("is null without any day", () => {
    expect(lowestDay("2026-11", 1, [])).toBeNull();
  });
});
