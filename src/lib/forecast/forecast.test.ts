import { describe, expect, it } from "vitest";
import { getMonthOverview } from "@/lib/budget/overview";
import { setup } from "@/lib/recurring/test-utils";
import { ForecastError } from "./errors";
import { getForecast } from "./forecast";

const monthsOf = (f: Awaited<ReturnType<typeof getForecast>>) => f.months.map((m) => m.month);
const kindsOf = (f: Awaited<ReturnType<typeof getForecast>>) => f.months.map((m) => m.kind);

describe("getForecast: options and timeline", () => {
  it("defaults to 3 past months, the current month and 6 months ahead", async () => {
    const { db } = await setup();
    const f = await getForecast(db, { today: "2026-10-11" });
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

  it("rolls over the year end", async () => {
    const { db } = await setup();
    const f = await getForecast(db, { today: "2026-12-31", months: 2, pastMonths: 2 });
    expect(monthsOf(f)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    const jan = await getForecast(db, { today: "2027-01-01", months: 1, pastMonths: 1 });
    expect(monthsOf(jan)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("handles today on the 31st without skipping short months", async () => {
    const { db } = await setup();
    const f = await getForecast(db, { today: "2026-01-31", months: 2, pastMonths: 0 });
    expect(monthsOf(f)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("supports horizons 1 and 36", async () => {
    const { db } = await setup();
    expect(
      monthsOf(await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 0 })),
    ).toEqual(["2026-10", "2026-11"]);
    const long = await getForecast(db, { today: "2026-10-11", months: 36, pastMonths: 0 });
    expect(long.months).toHaveLength(37);
    expect(long.months.at(-1)!.month).toBe("2029-10");
  });

  it("rejects invalid options with a ForecastError", async () => {
    const { db } = await setup();
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
      await expect(getForecast(db, opts), JSON.stringify(opts)).rejects.toThrow(ForecastError);
  });
});

describe("getForecast: month kinds and actuals", () => {
  it("marks uploaded past months actual, others no-data, now mixed and later forecast", async () => {
    const { db, cover } = await setup();
    await cover("2026-08");
    const f = await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 2 });
    expect(kindsOf(f)).toEqual(["actual", "no-data", "mixed", "forecast"]);
    expect(f.months.map((m) => m.hasUpload)).toEqual([true, false, false, false]);
    await cover("2026-10");
    expect(
      (await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 2 })).months[2],
    ).toMatchObject({ kind: "mixed", hasUpload: true });
  });

  it("reports actual months on exactly the month overview basis", async () => {
    const { db, tx, cover, cat } = await setup();
    await cover("2026-09");
    await tx("2026-09-01", -65000, { categoryId: await cat("Huur") });
    await tx("2026-09-03", -4237, { categoryId: await cat("Boodschappen") });
    await tx("2026-09-04", 500, { categoryId: await cat("Boodschappen") }); // refund
    await tx("2026-09-05", 123456, { categoryId: await cat("Salaris / bijbaan") });
    await tx("2026-09-06", -450); // uncategorised
    await tx("2026-09-07", -20000, { isInternalTransfer: true });
    await tx("2026-09-08", -1200, { currency: "GBP", categoryId: await cat("Vervoer") });
    const f = await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 1 });
    const sep = f.months[0];
    const o = await getMonthOverview(db, "2026-09");
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

  it("a month with a transaction in it has data, even when the statements stop before the month ends", async () => {
    const { db, tx, cat } = await setup();
    await tx("2026-09-27", -5000, { categoryId: await cat("Overig") }); // the statement ended on the 27th
    const f = await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 1 });
    expect(f.months[0]).toMatchObject({ kind: "actual", expenses: 5000 });
  });

  it("a month without any transaction and without an upload is still no-data, at zero", async () => {
    const { db } = await setup();
    const f = await getForecast(db, { today: "2026-10-11", months: 1, pastMonths: 1 });
    expect(f.months[0]).toMatchObject({ kind: "no-data", income: 0, expenses: 0, net: 0 });
  });
});
