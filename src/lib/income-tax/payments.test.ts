import { describe, expect, it } from "vitest";
import { getBtwSummary, quarterlyBtwPaymentIds, taxOfficeClassifier } from "@/lib/btw/summary";
import { setup } from "@/lib/recurring/test-utils";
import {
  TaxOfficePaymentNotFound,
  getIncomeTaxPayments,
  getTaxOfficePayments,
  incomeTaxPaymentYear,
  setIncomeTaxPaymentYear,
} from "./payments";
import { setIncomeTaxSettings } from "./settings";
import { addIncomeTaxYear } from "./years";

const TODAY = "2026-07-20";

/**
 * Invented: the second quarter's BTW is due on 31 July. On 10 July the person pays the tax office 840.00: the aanslag
 * for 2025, a one-off in a BTW payment window, which the BTW rules on their own would read as the quarter's BTW.
 */
async function world() {
  const s = await setup();
  await s.tx("2026-05-04", 121000, { counterparty: "Featurn B.V." });
  const aanslag = await s.tx("2026-07-10", -84000, {
    counterparty: "Belastingdienst",
    description: "Betalingskenmerk 0000 1111 2222 3333",
  });
  await addIncomeTaxYear(s.db, { year: 2025, rate: 0, knownAmount: 84000 });
  return { ...s, aanslag };
}

describe("an income tax payment is never the quarterly BTW", () => {
  it("before it is picked, the July payment reads as the second quarter's BTW (the BTW rule alone)", async () => {
    const w = await world();
    const btw = await getBtwSummary(w.db, { today: TODAY });
    expect(btw.quarter.label).toBe("2026-Q2");
    expect(btw.paid).toEqual({ amount: 84000, date: "2026-07-10" });
    expect(await quarterlyBtwPaymentIds(w.db)).toContain(w.aanslag.id);
  });

  it("once picked as income tax, the BTW card, the forecast's averages and the year card all agree", async () => {
    const w = await world();
    await setIncomeTaxPaymentYear(w.db, w.aanslag.id, 2025);
    const btw = await getBtwSummary(w.db, { today: TODAY });
    expect(btw.paid).toBeNull();
    expect(btw.toSetAside).toBe(btw.owed - btw.pocket);
    expect(await quarterlyBtwPaymentIds(w.db)).not.toContain(w.aanslag.id);
    expect(await getIncomeTaxPayments(w.db)).toEqual([
      { id: w.aanslag.id, date: "2026-07-10", amount: 84000, year: 2025 },
    ]);
  });

  it("with the reserve off the mark is ignored and the BTW reads as before", async () => {
    const w = await world();
    await setIncomeTaxPaymentYear(w.db, w.aanslag.id, 2025);
    await setIncomeTaxSettings(w.db, { on: false });
    expect((await getBtwSummary(w.db, { today: TODAY })).paid).toEqual({
      amount: 84000,
      date: "2026-07-10",
    });
    expect(await getIncomeTaxPayments(w.db)).toEqual([]);
  });

  it("taking the mark back makes it BTW again", async () => {
    const w = await world();
    await setIncomeTaxPaymentYear(w.db, w.aanslag.id, 2025);
    await setIncomeTaxPaymentYear(w.db, w.aanslag.id, null);
    expect((await getBtwSummary(w.db, { today: TODAY })).paid?.amount).toBe(84000);
  });

  it("the one rule: money out, to the tax office, picked for a year, with the reserve on", () => {
    const row = {
      amount: -84000,
      counterparty: "Belastingdienst",
      description: null,
      incomeTaxYear: 2025,
    };
    expect(incomeTaxPaymentYear(row, true)).toBe(2025);
    expect(incomeTaxPaymentYear(row, false)).toBeNull();
    expect(incomeTaxPaymentYear({ ...row, incomeTaxYear: null }, true)).toBeNull();
    expect(incomeTaxPaymentYear({ ...row, amount: 84000 }, true)).toBeNull();
    expect(incomeTaxPaymentYear({ ...row, counterparty: "Shop" }, true)).toBeNull();
    // The classifier without the reserve's flag is the BTW rule as it always was.
    const outflow = { ...row, date: "2026-07-10" };
    expect(taxOfficeClassifier([outflow]).isQuarterlyBtw(outflow)).toBe(true);
    expect(taxOfficeClassifier([outflow], { incomeTaxOn: true }).isQuarterlyBtw(outflow)).toBe(
      false,
    );
  });

  it("only a payment out to the tax office, and only for a tax year the person has", async () => {
    const w = await world();
    const shop = await w.tx("2026-07-11", -2000, { counterparty: "Shop" });
    const refund = await w.tx("2026-07-12", 2000, { counterparty: "Belastingdienst" });
    await expect(setIncomeTaxPaymentYear(w.db, shop.id, 2025)).rejects.toThrow(
      "Only a payment to the tax office can be income tax.",
    );
    await expect(setIncomeTaxPaymentYear(w.db, refund.id, 2025)).rejects.toThrow(
      "Only a payment to the tax office can be income tax.",
    );
    for (const bad of [2024, 1999, "2025", 2025.5])
      await expect(setIncomeTaxPaymentYear(w.db, w.aanslag.id, bad)).rejects.toThrow(
        "Pick one of your tax years for this payment.",
      );
    await expect(setIncomeTaxPaymentYear(w.db, 999999, 2025)).rejects.toBeInstanceOf(
      TaxOfficePaymentNotFound,
    );
  });

  it("lists the payments to the tax office to pick from, newest first", async () => {
    const w = await world();
    await w.tx("2026-07-15", -1500, { counterparty: "Shop" });
    const later = await w.tx("2026-08-01", -9900, { counterparty: "Belastingdienst" });
    await setIncomeTaxPaymentYear(w.db, later.id, 2025);
    expect(await getTaxOfficePayments(w.db, { from: "2026-01-01" })).toEqual([
      { id: later.id, date: "2026-08-01", amount: 9900, year: 2025 },
      { id: w.aanslag.id, date: "2026-07-10", amount: 84000, year: null },
    ]);
  });
});
