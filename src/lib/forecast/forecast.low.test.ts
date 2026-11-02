import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
import { getForecast } from "./forecast";

/**
 * August and September uploaded, groceries 300 each month (the everyday average), the bank's balance after each.
 * From October: rent 632 on the 1st, salary 968 on the 4th (or another day). Today is 11 October.
 */
async function scenario(balances: { aug: number; sep: number } | null, salaryDay = 4) {
  const s = await setup();
  const { tx, cover, cat, addItem } = s;
  await cover("2026-08", "2026-09");
  const groceries = await cat("Boodschappen");
  await tx("2026-08-05", -30000, { categoryId: groceries, balanceAfter: balances?.aug ?? null });
  await tx("2026-09-05", -30000, { categoryId: groceries, balanceAfter: balances?.sep ?? null });
  await addItem({
    name: "Huur",
    matchCounterparty: "Verhuurder",
    expectedAmount: 63200,
    dayOfMonth: 1,
    startDate: "2026-10-01",
    categoryId: await cat("Huur"),
  });
  await addItem({
    name: "Salaris",
    type: "income",
    matchCounterparty: "Werkgever",
    expectedAmount: 96800,
    dayOfMonth: salaryDay,
    startDate: "2026-10-01",
    categoryId: await cat("Salaris / bijbaan"),
  });
  return s;
}

type Db = Awaited<ReturnType<typeof setup>>["db"];
const run = (db: Db, over = {}) =>
  getForecast(db, { today: "2026-10-11", months: 2, pastMonths: 1, history: 2, ...over });

describe("getForecast: the lowest point of the checking balance in each month", () => {
  it("dips before the income lands, each future month starting where the one before ends", async () => {
    const { db } = await scenario({ aug: 50000, sep: 20000 });
    const f = await run(db);
    const [sep, oct, nov, dec] = f.months;
    expect(f.months.map((m) => m.kind)).toEqual(["actual", "mixed", "forecast", "forecast"]);
    expect(oct.variable).toBe(30000);
    expect(nov.variable).toBe(30000);

    // September is real: 500 until the 5th, then 200.
    expect(sep.low).toEqual({ amount: 20000, date: "2026-09-05" });
    // October: 200 for the days already behind; rent and salary are still expected, so they move on today
    // (net +336) and the 300 everyday spending is spread over the 21 days left. The low is the real start.
    expect(oct.low).toEqual({ amount: 20000, date: "2026-10-01" });
    // October ends on 200 + 336 - 300 = 236. November: rent on the 1st, 10 a day, salary on the 4th.
    expect(nov.low).toEqual({ amount: 23600 - 63200 - 3000, date: "2026-11-03" });
    // November ends on 236 + 336 - 300 = 272. December has 31 days: 3 days of spending is 29.03.
    expect(dec.low).toEqual({
      amount: 27200 - 63200 - Math.round((30000 * 3) / 31),
      date: "2026-12-03",
    });
  });

  it("chains the months: each starts on the end before it, which is the forecast's own account balance", async () => {
    const { db } = await scenario({ aug: 50000, sep: 20000 });
    const f = await run(db, { months: 4 });
    // Every month from October nets +36 (968 - 632 - 300), so each starts 36 higher than the month before.
    const lows = f.months.filter((m) => m.kind === "forecast").map((m) => m.low);
    expect(lows).toEqual([
      { amount: 23600 - 63200 - 3000, date: "2026-11-03" },
      { amount: 27200 - 63200 - Math.round(90000 / 31), date: "2026-12-03" },
      { amount: 30800 - 63200 - Math.round(90000 / 31), date: "2027-01-03" },
      { amount: 34400 - 63200 - Math.round(90000 / 28), date: "2027-02-03" },
    ]);
    // February ends on 380: the same as the chart's accounts line (opening balance plus net less set aside).
    const accounts = f.months.reduce((sum, m) => sum + m.net - m.setAside.total, f.openingBalance!);
    expect(accounts).toBe(38000);
  });

  it("does not dip when the balance is comfortable", async () => {
    const { db } = await scenario({ aug: 550000, sep: 520000 });
    const f = await run(db);
    for (const m of f.months) {
      expect(m.low).not.toBeNull();
      expect(m.low!.amount).toBeGreaterThan(0);
    }
    expect(f.months[2].low).toEqual({ amount: 523600 - 63200 - 3000, date: "2026-11-03" });
  });

  it("is null for every month when no balance is known, and for a past month without data", async () => {
    const { db } = await scenario(null);
    for (const m of (await run(db)).months) expect(m.low).toBeNull();

    const known = await scenario({ aug: 50000, sep: 20000 });
    const [jul, aug] = (await run(known.db, { pastMonths: 3 })).months;
    expect(jul.kind).toBe("no-data");
    expect(jul.low).toBeNull();
    // August's own days only: 800 before the first statement, 500 from the 5th.
    expect(aug.low).toEqual({ amount: 50000, date: "2026-08-05" });
  });

  it("the current month uses the real days so far, then what is still to come", async () => {
    const s = await scenario({ aug: 50000, sep: 20000 });
    const { tx, cat, cover, db } = s;
    await cover("2026-10");
    // Rent really paid on the 1st (matched in memory), groceries 120 on the 5th; the salary has not come yet.
    await tx("2026-10-01", -63200, {
      counterparty: "Verhuurder",
      categoryId: await cat("Huur"),
      balanceAfter: 20000 - 63200,
    });
    await tx("2026-10-05", -12000, {
      categoryId: await cat("Boodschappen"),
      balanceAfter: 20000 - 63200 - 12000,
    });
    const [sep, oct, nov] = (await run(db)).months;
    // A month boundary: October's rent does not touch September.
    expect(sep.low).toEqual({ amount: 20000, date: "2026-09-05" });
    expect(oct.variable).toBe(18000);
    expect(oct.low).toEqual({ amount: 20000 - 63200 - 12000, date: "2026-10-05" });
    // October ends on -552 + 968 (salary, still expected, moved to today) - 180 = 236, as before.
    expect(nov.low).toEqual({ amount: 23600 - 63200 - 3000, date: "2026-11-03" });
  });

  it("income on the 31st lands on the last day of a short month", async () => {
    const { db } = await scenario({ aug: 50000, sep: 20000 }, 31);
    const f = await run(db, { months: 4 });
    const at = (month: string) => f.months.find((m) => m.month === month)!.low;
    // The 31st is the 28th in February: the dip is on the 27th, the day before the salary lands.
    expect(at("2027-02")).toEqual({
      amount: 34400 - 63200 - Math.round((30000 * 27) / 28),
      date: "2027-02-27",
    });
    // In a 31-day month the dip is on the 30th; in a 30-day month (salary on the 30th) on the 29th.
    expect(at("2026-12")!.date).toBe("2026-12-30");
    expect(at("2026-11")!.date).toBe("2026-11-29");
  });
});
