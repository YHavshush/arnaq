import { describe, expect, it } from "vitest";
import { setBtwSettings } from "@/lib/btw/settings";
import { getForecast } from "@/lib/forecast/forecast";
import { setup } from "@/lib/recurring/test-utils";
import { setSavingsAnchor, setSavingsSettings } from "@/lib/savings/settings";
import { getSavingsSummary } from "@/lib/savings/summary";
import { loadNetWorth, loadOverzicht, loadPrognose } from "./load";

const TODAY = "2026-10-20";

/**
 * Invented numbers. The client paid 968.00 in August (BTW inside it: 968.00 x 21 / 121 = 168.00, the third quarter, not
 * paid yet), nothing went to a BTW pocket, and a statement says the savings hold `saved` on 1 October.
 */
async function world(saved: number, potInSavings: boolean) {
  const s = await setup();
  await s.tx("2026-07-01", 100000, { balanceAfter: 100000 });
  await s.tx("2026-08-01", 96800, { counterparty: "Featurn B.V.", balanceAfter: 196800 });
  await setSavingsAnchor(s.db, { amount: saved, asOf: "2026-10-01" });
  await setSavingsSettings(s.db, { goal: 10000 });
  await setBtwSettings(s.db, { potInSavings });
  return s;
}

describe("My BTW pot is part of my savings", () => {
  it("pot covers the BTW: 201.00 saved and 168.00 owed leave 33.00 of savings and nothing short", async () => {
    const { db } = await world(20100, true);
    const w = await loadNetWorth(db, TODAY);
    expect(w.btw).toEqual({ owed: 16800, pocket: 0, paid: false, net: -16800 });
    expect(w.btwPot).toEqual({ pot: 16800, savingsLeft: 3300, short: 0 });
    expect(w.savings.saved).toBe(20100);
  });

  it("pot smaller than the BTW: 100.00 saved and 168.00 owed is a pot of 100.00, short by 68.00", async () => {
    const { db } = await world(10000, true);
    expect((await loadNetWorth(db, TODAY)).btwPot).toEqual({
      pot: 10000,
      savingsLeft: 0,
      short: 6800,
    });
  });

  it("no savings, no pot", async () => {
    const { db } = await world(0, true);
    expect((await loadNetWorth(db, TODAY)).btwPot).toEqual({
      pot: 0,
      savingsLeft: 0,
      short: 16800,
    });
  });

  it("setting off: no pot, the savings stay whole", async () => {
    const { db } = await world(20100, false);
    expect((await loadNetWorth(db, TODAY)).btwPot).toEqual({
      pot: 0,
      savingsLeft: 20100,
      short: 16800,
    });
    expect(await getSavingsSummary(db, { today: TODAY })).toMatchObject({
      saved: 20100,
      btwPot: 0,
    });
  });

  it("net worth is the same with the setting on or off: the savings count once", async () => {
    for (const saved of [0, 10000, 20100]) {
      const on = await loadNetWorth((await world(saved, true)).db, TODAY);
      const off = await loadNetWorth((await world(saved, false)).db, TODAY);
      const { btwPot: potOn, ...restOn } = on;
      const { btwPot: potOff, ...restOff } = off;
      expect(restOn).toEqual(restOff);
      expect(on.total).toBe(off.total);
      expect(on.total).toBe(196800 + saved - 16800);
      // Only the presentation differs: what is left of the savings plus the pot is the savings.
      expect(potOn.savingsLeft + potOn.pot).toBe(potOff.savingsLeft);
    }
  });

  it("every forecast number is the same with the setting on or off", async () => {
    for (const saved of [10000, 20100]) {
      const on = await world(saved, true);
      const off = await world(saved, false);
      const forecast = async (db: typeof on.db) =>
        await getForecast(db, { today: TODAY, months: 6, pastMonths: 1 });
      const fOn = await forecast(on.db);
      const fOff = await forecast(off.db);
      // The settings echo carries no BTW setting, so the whole forecast must match.
      expect(fOn).toEqual(fOff);
      expect(fOn.btwNow).toBe(-16800);
      expect(fOn.openingSavings).toBe(fOff.openingSavings);
      // The screen's version of it, with the net worth line, too.
      expect(await loadPrognose(on.db, TODAY, 6, "en", "budget")).toEqual(
        await loadPrognose(off.db, TODAY, 6, "en", "budget"),
      );
    }
  });

  it("the savings goal counts only the savings left after the pot", async () => {
    const on = await world(20100, true);
    const summary = await getSavingsSummary(on.db, { today: TODAY });
    expect(summary).toMatchObject({ saved: 20100, btwPot: 16800, goal: 10000 });

    const today = await loadOverzicht(on.db, "2026-10", TODAY, "en");
    expect(today.savingsRow).toMatchObject({ saved: 20100, forGoal: 3300, goal: 10000 });
    // Today's net worth still counts the savings once, whole.
    const off = await world(20100, false);
    const todayOff = await loadOverzicht(off.db, "2026-10", TODAY, "en");
    expect(today.netWorth).toEqual(todayOff.netWorth);
    expect(todayOff.savingsRow).toMatchObject({ saved: 20100, forGoal: 20100 });

    // The savings card: 33.00 of 100.00, not reached; with the setting off 201.00 reaches the goal.
    const tile = (o: typeof today) => o.tiles.find((t) => t.key === "sparen")!;
    expect(tile(today).goal).toEqual({ saved: 3300, target: 10000 });
    expect(tile(todayOff).goal).toEqual({ saved: 20100, target: 10000 });
  });
});
