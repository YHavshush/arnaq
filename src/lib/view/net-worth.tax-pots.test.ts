import { describe, expect, it } from "vitest";
import { setBtwSettings } from "@/lib/btw/settings";
import { getForecast } from "@/lib/forecast/forecast";
import { setIncomeTaxSettings } from "@/lib/income-tax/settings";
import { addIncomeTaxYear } from "@/lib/income-tax/years";
import { setup } from "@/lib/recurring/test-utils";
import { setSavingsAnchor, setSavingsSettings } from "@/lib/savings/settings";
import { getSavingsSummary } from "@/lib/savings/summary";
import { loadNetWorth, loadOverzicht, loadPrognose } from "./load";

const TODAY = "2026-10-20";

/**
 * Invented numbers. The client paid 968.00 in August: 168.00 BTW inside it (the third quarter, not paid) and 800.00
 * without BTW, at a 10% income tax rate 80.00. Nothing is in either pocket; a statement says the savings hold 201.00.
 */
async function world(pots: boolean) {
  const s = await setup();
  await s.tx("2026-07-01", 100000, { balanceAfter: 100000 });
  await s.tx("2026-08-01", 96800, { counterparty: "Featurn B.V.", balanceAfter: 196800 });
  await setSavingsAnchor(s.db, { amount: 20100, asOf: "2026-10-01" });
  await setSavingsSettings(s.db, { goal: 10000 });
  await addIncomeTaxYear(s.db, { year: 2026, rate: 1000 });
  await setBtwSettings(s.db, { potInSavings: pots });
  await setIncomeTaxSettings(s.db, { potInSavings: pots });
  return s;
}

describe("both pots in the savings: BTW first, then income tax", () => {
  it("the BTW pot takes 168.00, the income tax pot the 33.00 left, and 47.00 is still short", async () => {
    const { db } = await world(true);
    const w = await loadNetWorth(db, TODAY);
    expect(w.btwPot).toEqual({ pot: 16800, savingsLeft: 3300, short: 0 });
    expect(w.incomeTaxPot).toEqual({ pot: 3300, short: 4700 });
    expect(w.incomeTax).toEqual({ owed: 8000, pocket: 0, net: -8000 });
    const summary = await getSavingsSummary(db, { today: TODAY });
    expect(summary).toMatchObject({ saved: 20100, btwPot: 16800, incomeTaxPot: 3300 });
    // The goal counts the savings minus both pots.
    const today = await loadOverzicht(db, "2026-10", TODAY, "en");
    expect(today.savingsRow).toMatchObject({ saved: 20100, forGoal: 0 });
  });

  it("net worth and every forecast number are the same with the pots on or off", async () => {
    const on = await world(true);
    const off = await world(false);
    const wOn = await loadNetWorth(on.db, TODAY);
    const wOff = await loadNetWorth(off.db, TODAY);
    const { btwPot: bOn, incomeTaxPot: iOn, ...restOn } = wOn;
    const { btwPot: bOff, incomeTaxPot: iOff, ...restOff } = wOff;
    expect(restOn).toEqual(restOff);
    expect(wOn.total).toBe(196800 + 20100 - 16800 - 8000);
    // Only the presentation differs: what is left plus both pots is the savings.
    const leftOn = bOn.savingsLeft - iOn.pot;
    expect(leftOn).toBe(0);
    expect(leftOn + iOn.pot + bOn.pot).toBe(bOff.savingsLeft);
    expect(iOff.pot + bOff.pot).toBe(0);

    const forecast = (db: typeof on.db) =>
      getForecast(db, { today: TODAY, months: 6, pastMonths: 1 });
    expect(await forecast(on.db)).toEqual(await forecast(off.db));
    expect(await loadPrognose(on.db, TODAY, 6, "en", "budget")).toEqual(
      await loadPrognose(off.db, TODAY, 6, "en", "budget"),
    );
  });
});
