import { describe, expect, it } from "vitest";
import { setIncomeTaxPaymentYear } from "@/lib/income-tax/payments";
import { setIncomeTaxSettings } from "@/lib/income-tax/settings";
import { addIncomeTaxYear } from "@/lib/income-tax/years";
import { setup } from "@/lib/recurring/test-utils";
import { loadNetWorth } from "@/lib/view/load";
import { buildPrognose } from "@/lib/view/prognose";
import { getForecast } from "./forecast";

const TODAY = "2026-10-11";

/**
 * The forecast.btw world, with invented numbers. August and September uploaded. The client paid 2,000.00 on 1 August
 * (BTW inside it 347.11, so 1,652.89 without BTW), 100.00 went into the BTW pocket on 5 August, and from October the
 * client's invoice of 2,420.00 (2,000.00 without BTW) is a fixed income item on the 25th. No spending.
 */
async function world() {
  const s = await setup();
  const savings = await s.cat("Spaarrekening");
  await s.cover("2026-08", "2026-09");
  await s.tx("2026-08-01", 200000, { counterparty: "Featurn B.V.", balanceAfter: 500000 });
  await s.tx("2026-08-05", -10000, {
    counterparty: "To EUR BTW",
    categoryId: savings,
    isInternalTransfer: true,
    balanceAfter: 490000,
  });
  await s.addItem({
    name: "Featurn invoice",
    type: "income",
    matchCounterparty: "Featurn B.V.",
    expectedAmount: 242000,
    dayOfMonth: 25,
    startDate: "2026-10-01",
    categoryId: await s.cat("Salaris / bijbaan"),
  });
  const forecast = () => getForecast(s.db, { today: TODAY, months: 2, pastMonths: 2 });
  return { ...s, savings, forecast };
}

describe("getForecast: the income tax reserve in net worth", () => {
  it("rate 0, no year, or the reserve off: every forecast number is what it was", async () => {
    const plain = await (await world()).forecast();
    expect(plain.incomeTaxNow).toBe(0);
    expect(plain.months.every((m) => m.incomeTaxAccrued === 0 && m.incomeTaxWorth === 0)).toBe(
      true,
    );

    const zero = await world();
    await addIncomeTaxYear(zero.db, { year: 2026, rate: 0 });
    expect(await zero.forecast()).toEqual(plain);

    const off = await world();
    await addIncomeTaxYear(off.db, { year: 2026, rate: 490 });
    await setIncomeTaxSettings(off.db, { on: false });
    expect(await off.forecast()).toEqual(plain);
  });

  it("takes the reserve off as it builds: what came in now, and the rate on each month's expected client income", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const f = await w.forecast();
    // Now: 4.9% of the 1,652.89 without BTW that came in (80.99), nothing in the pocket.
    expect(f.incomeTaxNow).toBe(-Math.round((165289 * 490) / 10000));
    expect(f.incomeTaxNow).toBe(-8099);
    expect(f.months.map((m) => [m.month, m.incomeTaxAccrued])).toEqual([
      ["2026-08", 0],
      ["2026-09", 0],
      ["2026-10", 9800],
      ["2026-11", 9800],
      ["2026-12", 9800],
    ]);
    expect(f.months.map((m) => m.incomeTaxWorth)).toEqual([
      -8099,
      -8099,
      -8099 - 9800,
      -8099 - 2 * 9800,
      -8099 - 3 * 9800,
    ]);
    // Cash stays cash: expenses and net do not carry it.
    expect(f.months[3].net).toBe(242000);
  });

  it("the net worth line counts it once, adds up, and starts where the net worth card is", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const p = buildPrognose(await w.forecast(), "en");
    const [, sep, oct, nov, dec] = p.points;
    expect(oct.cumulative).toBe(sep.cumulative + oct.net);
    expect(nov.cumulative).toBe(oct.cumulative + nov.net);
    expect(dec.cumulative).toBe(nov.cumulative + dec.net);
    // Growth takes off both the BTW and the income tax taken on.
    expect(nov.net).toBe(242000 - 42000 - 9800);
    expect(nov.incomeTaxAccrued).toBe(9800);
    expect(nov.expenseParts.lines.map((l) => l.key)).toContain("incomeTax");
    for (const pt of p.points)
      expect(pt.accounts + pt.savings + pt.btw + pt.incomeTax).toBe(pt.cumulative);
    const card = await loadNetWorth(w.db, TODAY);
    expect(card.incomeTax.net).toBe(-8099);
    expect(p.netWorth!.start).toBe(card.total);
  });

  it("a move into the income tax pocket changes no net worth number, and leaves the savings alone", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const before = buildPrognose(await w.forecast(), "en");
    await w.tx("2026-09-03", -5000, {
      counterparty: "To Inkomstenbelasting",
      categoryId: w.savings,
      isInternalTransfer: true,
      balanceAfter: 485000,
    });
    await w.addItem({
      name: "To Inkomstenbelasting",
      expectedAmount: 9800,
      dayOfMonth: 26,
      startDate: "2026-10-01",
      categoryId: w.savings,
    });
    const f = await w.forecast();
    expect(f.incomeTaxNow).toBe(5000 - 8099);
    const after = buildPrognose(f, "en");
    // The moves leave the account but stay the person's money: from the month of the move on, the line is where it
    // was. (Months before it carry the income tax now, pocket included: the same known limitation as the BTW part.)
    expect(after.points.slice(1).map((pt) => pt.cumulative)).toEqual(
      before.points.slice(1).map((pt) => pt.cumulative),
    );
    expect(after.points.map((pt) => pt.savings)).toEqual(before.points.map((pt) => pt.savings));
  });

  it("paying the aanslag does not count twice: the line ahead is the same paid or not", async () => {
    const unpaid = await world();
    await addIncomeTaxYear(unpaid.db, { year: 2025, rate: 0, knownAmount: 50000 });
    await unpaid.tx("2026-09-15", -1, { counterparty: "Bakery", balanceAfter: 489999 });

    const paid = await world();
    await addIncomeTaxYear(paid.db, { year: 2025, rate: 0, knownAmount: 50000 });
    await paid.tx("2026-09-15", -1, { counterparty: "Bakery", balanceAfter: 489999 });
    const aanslag = await paid.tx("2026-09-20", -50000, {
      counterparty: "Belastingdienst",
      description: "Betalingskenmerk 1234",
      balanceAfter: 439999,
    });
    await setIncomeTaxPaymentYear(paid.db, aanslag.id, 2025);

    const fUnpaid = await unpaid.forecast();
    const fPaid = await paid.forecast();
    expect(fUnpaid.incomeTaxNow).toBe(-50000);
    expect(fPaid.incomeTaxNow).toBe(0);
    // The averages leave the payment out, so the months ahead spend the same.
    expect(fPaid.months.slice(2).map((m) => m.expenses)).toEqual(
      fUnpaid.months.slice(2).map((m) => m.expenses),
    );
    const end = (f: typeof fPaid) => buildPrognose(f, "en").points.at(-1)!.cumulative;
    expect(end(fPaid)).toBe(end(fUnpaid));
    expect((await loadNetWorth(paid.db, TODAY)).total).toBe(
      (await loadNetWorth(unpaid.db, TODAY)).total,
    );
  });
});
