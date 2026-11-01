import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
import { ForecastError } from "./errors";
import { getForecast } from "./forecast";
import { getOwnSpending, scaleAverages, setOwnSpending } from "./own";
import type { VariableAverages } from "./variable";

const averages = (byCategory: [number, number][], uncategorised = 0): VariableAverages => ({
  months: ["2026-08"],
  byCategory: new Map(byCategory),
  uncategorised,
  lowConfidence: false,
  reason: null,
});

describe("own spending", () => {
  it("saves a monthly amount, clears it with null, and refuses a negative or fractional one", async () => {
    const { db } = await setup();
    expect(await getOwnSpending(db)).toBeNull();
    expect(await setOwnSpending(db, 150000)).toBe(150000);
    expect(await setOwnSpending(db, 0)).toBe(0);
    expect(await setOwnSpending(db, null)).toBeNull();
    await expect(setOwnSpending(db, -1)).rejects.toBeInstanceOf(ForecastError);
    await expect(setOwnSpending(db, 10.5)).rejects.toBeInstanceOf(ForecastError);
  });

  it("scaleAverages shares the number over the categories in the proportions of their averages, to the cent", () => {
    const scaled = scaleAverages(
      averages(
        [
          [1, 60000],
          [2, 30000],
        ],
        10000,
      ),
      50000,
    );
    expect(scaled.byCategory.get(1)).toBe(30000);
    expect(scaled.byCategory.get(2)).toBe(15000);
    expect(scaled.uncategorised).toBe(5000);
    const total = [...scaled.byCategory.values()].reduce((s, v) => s + v, 0) + scaled.uncategorised;
    expect(total).toBe(50000);
  });

  it("with no averages the whole amount is uncategorised", () => {
    const scaled = scaleAverages(averages([[1, 0]]), 40000);
    expect(scaled.byCategory.size).toBe(0);
    expect(scaled.uncategorised).toBe(40000);
  });

  it("the forecast with basis own spends exactly the typed amount a month on everyday things", async () => {
    const s = await setup();
    const groceries = await s.cat("Boodschappen");
    await s.cover("2026-07", "2026-08", "2026-09");
    for (const month of ["2026-07", "2026-08", "2026-09"])
      await s.tx(`${month}-10`, -90000, { categoryId: groceries });
    const f = await getForecast(s.db, {
      today: "2026-10-11",
      months: 1,
      pastMonths: 0,
      basis: "own",
      ownSpending: 120000,
    });
    const nov = f.months.find((m) => m.month === "2026-11")!;
    expect(nov.categories.reduce((sum, c) => sum + c.variable, 0)).toBe(120000);
    // Without an amount typed it falls back to the averages.
    const fallback = await getForecast(s.db, {
      today: "2026-10-11",
      months: 1,
      pastMonths: 0,
      basis: "own",
      ownSpending: null,
    });
    expect(
      fallback.months
        .find((m) => m.month === "2026-11")!
        .categories.reduce((sum, c) => sum + c.variable, 0),
    ).toBe(90000);
  });
});
