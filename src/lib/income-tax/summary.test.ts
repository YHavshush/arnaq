import { describe, expect, it } from "vitest";
import { setup } from "@/lib/recurring/test-utils";
import { setIncomeTaxPaymentYear } from "./payments";
import { setIncomeTaxSettings } from "./settings";
import { getIncomeTaxSummary, incomeTaxNetWorth } from "./summary";
import { addIncomeTaxYear, updateIncomeTaxYear } from "./years";

const TODAY = "2026-10-11";

/**
 * Invented numbers. Featurn (21%, the test database's client) paid 1,210.00 in March and in October: 2,000.00 without
 * BTW so far. Its 2,420.00 invoice is a fixed income item on the 25th from October: 2,000.00 without BTW in each of
 * October, November and December still to come. 50.00 went into the income tax pocket in September.
 */
async function world() {
  const s = await setup();
  await s.tx("2026-03-05", 121000, { counterparty: "Featurn B.V." });
  await s.tx("2026-10-05", 121000, { counterparty: "Featurn B.V." });
  await s.addItem({
    name: "Featurn invoice",
    type: "income",
    matchCounterparty: "Featurn B.V.",
    expectedAmount: 242000,
    dayOfMonth: 25,
    startDate: "2026-10-01",
    categoryId: await s.cat("Salaris / bijbaan"),
  });
  await s.tx("2026-09-01", -5000, {
    counterparty: "To Inkomstenbelasting",
    categoryId: await s.cat("Spaarrekening"),
    isInternalTransfer: true,
  });
  const summary = (today = TODAY) => getIncomeTaxSummary(s.db, { today });
  const taxOffice = (date: string, amount: number) =>
    s.tx(date, amount, { counterparty: "Belastingdienst", description: "Betalingskenmerk 1234" });
  return { ...s, summary, taxOffice };
}

describe("getIncomeTaxSummary: the year cards", () => {
  it("a year with no rate typed has no card, and nothing is active", async () => {
    const w = await world();
    expect(await w.summary()).toEqual({
      active: false,
      pocket: 0,
      years: [],
      owed: 0,
      toSetAside: 0,
    });
    // Rate 0 without a known amount is the same as no year.
    await addIncomeTaxYear(w.db, { year: 2026, rate: 0 });
    expect((await w.summary()).active).toBe(false);
  });

  it("estimate mode: set aside so far of what the year is expected to come to, the pocket and what is missing", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const s = await w.summary();
    expect(s.active).toBe(true);
    expect(s.pocket).toBe(5000);
    expect(s.years).toHaveLength(1);
    expect(s.years[0]).toMatchObject({
      year: 2026,
      mode: "estimate",
      base: { received: 200000, expected: 600000 },
      soFar: 9800, // 4.9% of 2,000.00
      expected: 39200, // 4.9% of 8,000.00
      known: null,
      paid: 0,
      owed: 9800,
      pocket: 5000,
      toSetAside: 4800,
    });
    expect(incomeTaxNetWorth(s)).toBe(5000 - 9800);
  });

  it("known mode: the amount on the aanslag replaces the estimate, less what was paid for that year", async () => {
    const w = await world();
    const year = await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    await updateIncomeTaxYear(w.db, year.id, { knownAmount: 33500 });
    const paid = await w.taxOffice("2026-07-10", -10000);
    await setIncomeTaxPaymentYear(w.db, paid.id, 2026);
    const [y] = (await w.summary()).years;
    expect(y).toMatchObject({
      mode: "known",
      expected: 33500,
      known: 33500,
      paid: 10000,
      owed: 23500,
      pocket: 5000,
      toSetAside: 18500,
    });
    expect(y.payments.map((p) => p.amount)).toEqual([10000]);
  });

  it("last year in known mode and this year in estimate mode are open at once; the pocket covers the oldest first", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2025, rate: 0, knownAmount: 84000 });
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const part = await w.taxOffice("2026-07-10", -30000);
    await setIncomeTaxPaymentYear(w.db, part.id, 2025);
    const s = await w.summary();
    expect(s.years.map((y) => [y.year, y.mode, y.owed, y.pocket, y.toSetAside])).toEqual([
      [2025, "known", 54000, 5000, 49000],
      [2026, "estimate", 9800, 0, 9800],
    ]);
    expect(s.owed).toBe(54000 + 9800);
    expect(s.toSetAside).toBe(49000 + 9800);

    // Paying the rest closes 2025; the pocket then covers 2026.
    const rest = await w.taxOffice("2026-08-10", -54000);
    await setIncomeTaxPaymentYear(w.db, rest.id, 2025);
    const after = await w.summary();
    expect(after.years.map((y) => [y.year, y.pocket, y.toSetAside])).toEqual([[2026, 5000, 4800]]);
  });

  it("a year after today's has no card yet, and a year that ended keeps only what came in", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2027, rate: 650 });
    expect((await w.summary()).years).toEqual([]);
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    // In 2027 the 2026 items are no longer expected: what came in is what the year was.
    const [y2026] = (await w.summary("2027-02-01")).years;
    expect(y2026).toMatchObject({ year: 2026, base: { expected: 0 } });
    expect(y2026.soFar).toBe(y2026.expected);
  });

  it("with the reserve off nothing is shown, and nothing counts", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    await setIncomeTaxSettings(w.db, { on: false });
    const s = await w.summary();
    expect(s.active).toBe(false);
    expect(incomeTaxNetWorth(s)).toBe(0);
  });
});
