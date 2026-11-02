import { describe, expect, it } from "vitest";
import { setBudget } from "@/lib/budget/budgets";
import { setup } from "@/lib/recurring/test-utils";
import { buildPrognose } from "@/lib/view/prognose";
import { loadNetWorth } from "@/lib/view/load";
import { getForecast } from "./forecast";

const TODAY = "2026-10-11";

/**
 * August and September uploaded. The client paid 2,000.00 on 1 August (BTW inside it: 347.11), 100.00 went into the
 * BTW pocket on 5 August, and from October the client's invoice of 2,420.00 is a fixed income item on the 25th
 * (BTW inside it: 420.00). Nothing else happens: no spending at all.
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
  const forecast = (basis: "averages" | "budget" | "own" = "averages") =>
    getForecast(s.db, { today: TODAY, months: 2, pastMonths: 2, basis });
  return { ...s, savings, forecast };
}

describe("getForecast: the BTW in net worth", () => {
  it("knows the BTW now exactly as the net worth card does: pocket minus what is still owed", async () => {
    const w = await world();
    const f = await w.forecast();
    const card = await loadNetWorth(w.db, TODAY);
    expect(card.btw.net).toBe(10000 - 34711);
    expect(f.btwNow).toBe(card.btw.net);
  });

  it("accrues 21/121 of the client's expected income in each month ahead, and nothing in real months", async () => {
    const f = await (await world()).forecast();
    expect(f.months.map((m) => [m.month, m.kind, m.btwAccrued])).toEqual([
      ["2026-08", "actual", 0],
      ["2026-09", "actual", 0],
      ["2026-10", "mixed", 42000],
      ["2026-11", "forecast", 42000],
      ["2026-12", "forecast", 42000],
    ]);
  });

  it("leaves expenses, net and the categories cash based", async () => {
    const f = await (await world()).forecast();
    const nov = f.months[3];
    expect(nov.expenses).toBe(0);
    expect(nov.net).toBe(242000);
    expect(nov.categories.every((c) => c.total === 0)).toBe(true);
  });

  it("does not accrue on income from someone else", async () => {
    const w = await world();
    await w.addItem({
      name: "Salary",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 100000,
      dayOfMonth: 20,
      startDate: "2026-10-01",
    });
    const f = await w.forecast();
    expect(f.months[3].btwAccrued).toBe(42000);
  });
});

describe("buildPrognose: the net worth line counts the BTW once", () => {
  it("starts from the balances plus the BTW now, and every month ahead adds its growth (which already counts the BTW accrued as an expense)", async () => {
    const w = await world();
    const f = await w.forecast();
    const p = buildPrognose(f, "en");
    const [aug, sep, oct, nov, dec] = p.points;
    const btwNow = 10000 - 34711;
    // August: the opening balance (300000), the client's 2000, less the 100 that went into the pocket (the pocket is in
    // the BTW now), plus the BTW now.
    expect(aug.cumulative).toBe(300000 + (f.openingSavings ?? 0) + 200000 - 10000 + btwNow);
    // Real months are shifted by the same BTW now.
    expect(sep.cumulative).toBe(aug.cumulative);
    expect(oct.cumulative).toBe(sep.cumulative + oct.net);
    expect(nov.cumulative).toBe(oct.cumulative + nov.net);
    expect(dec.cumulative).toBe(nov.cumulative + dec.net);
    expect(p.points.map((pt) => pt.btwAccrued)).toEqual([0, 0, 42000, 42000, 42000]);
    // The parts still add up: accounts, savings and the BTW (the pocket less what is owed).
    for (const pt of p.points) expect(pt.accounts + pt.savings + pt.btw).toBe(pt.cumulative);
    expect(p.netWorth).toEqual({ start: sep.cumulative, end: dec.cumulative });
  });

  it("starts where the net worth card is when nothing has moved since the last real month", async () => {
    const w = await world();
    const p = buildPrognose(await w.forecast(), "en");
    const card = await loadNetWorth(w.db, TODAY);
    expect(p.netWorth!.start).toBe(card.total);
  });

  it("a planned move into the BTW pocket changes nothing: it is the person's own money in another account", async () => {
    const w = await world();
    const before = buildPrognose(await w.forecast(), "en");
    await w.addItem({
      name: "BTW reserve",
      matchCounterparty: "EUR BTW",
      expectedAmount: 42000,
      dayOfMonth: 26,
      startDate: "2026-10-01",
      categoryId: w.savings,
    });
    const after = buildPrognose(await w.forecast(), "en");
    expect(after.points.map((p) => p.cumulative)).toEqual(before.points.map((p) => p.cumulative));
    // It does leave the accounts.
    expect(after.points[3].accounts).toBe(before.points[3].accounts - 2 * 42000);
  });

  it("is the same rule with the budget basis, applied once", async () => {
    const w = await world();
    await setBudget(w.db, await w.cat("Boodschappen"), "2026-10", 30000);
    const f = await w.forecast("budget");
    const p = buildPrognose(f, "en", "budget");
    const [, sep, oct, nov] = p.points;
    expect(oct.cumulative).toBe(sep.cumulative + oct.net);
    expect(nov.cumulative).toBe(oct.cumulative + nov.net);
    expect(nov.net).toBe(242000 - 30000 - 42000); // the BTW to set aside (42000) is an expense
  });

  it("without BTW data the line is what it was", async () => {
    const s = await setup();
    await s.cover("2026-09");
    await s.tx("2026-09-10", -2000, { balanceAfter: 300000, counterparty: "Shop" });
    const f = await getForecast(s.db, { today: TODAY, months: 2, pastMonths: 1 });
    expect(f.btwNow).toBe(0);
    const p = buildPrognose(f, "en");
    expect(p.points.map((pt) => pt.cumulative)).toEqual(
      f.months.map((m) => m.cumulativeNet + (f.openingBalance ?? 0) + (f.openingSavings ?? 0)),
    );
    expect(p.points.every((pt) => pt.btw === 0 && pt.btwAccrued === 0)).toBe(true);
  });
});
