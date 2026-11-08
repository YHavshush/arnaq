import { describe, expect, it } from "vitest";
import { getBudgetsByMonth } from "@/lib/budget/budgets";
import { setup } from "@/lib/recurring/test-utils";
import { loadPlan } from "@/lib/view/plan";
import { replaceBtwClients } from "./clients";
import { btwShareForMonth, btwTrueUp } from "./share";

/**
 * Invented numbers. The client pays each invoice about a month after it is dated: 1,000.00 on 4 October (September's
 * invoice), 1,000.00 on 4 November and 4 December, and 2,000.00 on 4 January (December's invoice). The fourth quarter's
 * BTW, 600.00, is paid on 25 January.
 */
async function world(paymentLag: 0 | 1) {
  const s = await setup();
  const taxes = await s.cat("Belastingen");
  await replaceBtwClients(s.db, [{ name: "Featurn", paymentLag, vatPercent: 21 }]);
  const paid = (date: string, amount: number) =>
    s.tx(date, amount, { counterparty: "Featurn B.V." });
  await paid("2026-10-04", 100000);
  await paid("2026-11-04", 100000);
  await paid("2026-12-04", 100000);
  await paid("2027-01-04", 200000);
  await s.tx("2027-01-25", -60000, { counterparty: "Belastingdienst", categoryId: taxes });
  return { ...s, taxes };
}
const TODAY = "2027-01-28";

describe("the month's BTW share follows the month the money arrives, whatever the lag", () => {
  it("is the same for lag 0 and lag 1: the lag only decides which quarter it counts for", async () => {
    for (const lag of [0, 1] as const) {
      const w = await world(lag);
      expect((await btwShareForMonth(w.db, { month: "2026-10", today: TODAY })).share).toBe(17355);
      expect((await btwShareForMonth(w.db, { month: "2027-01", today: TODAY })).share).toBe(34711);
    }
  });
});

describe("the quarter's true-up uses the same receipt window as the quarter card", () => {
  it("lag 0: the fourth quarter's BTW is October to December's money (520.66): 600.00 paid is more, nothing comes off", async () => {
    const w = await world(0);
    expect(await btwTrueUp(w.db, { month: "2027-01" })).toBe(0);
  });

  it("lag 1: the fourth quarter's BTW is November to January's money (694.21): 94.21 less was paid, it comes off January", async () => {
    const w = await world(1);
    expect(await btwTrueUp(w.db, { month: "2027-01" })).toBe(69421 - 60000);
    expect(await btwTrueUp(w.db, { month: "2026-12" })).toBe(0);
  });

  it("the Today screen's taxes budget carries it", async () => {
    const jan = async (lag: 0 | 1) => {
      const w = await world(lag);
      const b = await getBudgetsByMonth(w.db, "2027-01", "2027-01", { btw: { today: TODAY } });
      return b.get("2027-01")!.btw.get(w.taxes);
    };
    expect(await jan(0)).toBe(34711);
    expect(await jan(1)).toBe(34711 - 9421);
  });
});

describe("the plan grid's BTW row", () => {
  it("shows the BTW in the month the money is expected, the same for every lag", async () => {
    const rows = async (lag: 0 | 1) => {
      const w = await world(lag);
      await w.addItem({
        name: "Featurn invoice",
        type: "income",
        matchCounterparty: "Featurn B.V.",
        expectedAmount: 242000,
        dayOfMonth: 4,
        startDate: "2027-02-01",
        categoryId: await w.cat("Salaris / bijbaan"),
      });
      const plan = await loadPlan(w.db, TODAY, { months: 3, basis: "averages" });
      return plan.sections.btw[0].cells.map((c) => [c.month, c.amount]);
    };
    const lag0 = await rows(0);
    expect(lag0.find(([m]) => m === "2027-02")?.[1]).toBe(42000);
    expect(await rows(1)).toEqual(lag0);
  });
});
