import { describe, expect, it } from "vitest";
import { getBudgetsByMonth } from "@/lib/budget/budgets";
import { getForecast } from "@/lib/forecast/forecast";
import { setup } from "@/lib/recurring/test-utils";
import { loadPlan } from "@/lib/view/plan";
import { deleteBtwClient, getBtwClients, replaceBtwClients } from "./clients";
import { btwInside } from "./rate";
import { btwShareForMonth } from "./share";
import { getBtwSummary } from "./summary";

/**
 * Invented clients and amounts. Three clients:
 * - Featurn pays in the month of the invoice (lag 0), 21%: the fourth quarter is October to December's money;
 * - Acme pays about a month later (lag 1), 21%: November to January's money;
 * - Globex, a business client in another EU country, pays about two months later (lag 2) and is charged no BTW (0%):
 *   December to February's money, none of it BTW.
 */
async function world() {
  const s = await setup();
  await replaceBtwClients(s.db, [
    { name: "Featurn", paymentLag: 0, vatPercent: 21 },
    { name: "Acme", paymentLag: 1, vatPercent: 21 },
    { name: "Globex", paymentLag: 2, vatPercent: 0 },
  ]);
  const from = (name: string) => (date: string, amount: number) =>
    s.tx(date, amount, { counterparty: name });
  return {
    ...s,
    featurn: from("Featurn B.V."),
    acme: from("ACME Ltd"),
    globex: from("Globex GmbH"),
    clients: async () => await getBtwClients(s.db),
  };
}

const TODAY = "2027-01-20"; // the card is about 2026-Q4 (due 31 January)

describe("getBtwSummary with several clients", () => {
  it("sums each client's money in its own receipt window, with its own rate", async () => {
    const w = await world();
    await w.featurn("2026-09-30", 121000); // the third quarter's
    await w.featurn("2026-10-01", 121000);
    await w.featurn("2026-12-31", 242000);
    await w.featurn("2027-01-02", 99999); // the first quarter's (lag 0)
    await w.acme("2026-10-31", 121000); // September's invoice: the third quarter (lag 1)
    await w.acme("2026-11-01", 242000);
    await w.acme("2027-01-15", 363000);
    await w.globex("2026-11-30", 400000); // the third quarter's (lag 2)
    await w.globex("2026-12-01", 500000);
    const s = await getBtwSummary(w.db, { today: TODAY });
    expect(s.quarter.label).toBe("2026-Q4");
    // The widest window: from the earliest start (Featurn, 1 October) to the latest end (Globex, 28 February).
    expect(s.receipts).toEqual({ from: "2026-10-01", to: "2027-02-28" });
    expect(s.complete).toBe(false);
    // Turnover: every client's money in its window, the 0% client's too.
    expect(s.received).toBe(121000 + 242000 + 242000 + 363000 + 500000);
    // BTW: only the 21% clients' money, 21 parts of every 121.
    expect(s.owed).toBe(btwInside(121000 + 242000 + 242000 + 363000));
    expect(s.owed).toBe(168000);
    expect(s.toSetAside).toBe(168000);
  });

  it("a payment that names two clients counts for the longer name, in that client's window", async () => {
    const w = await world();
    // Names Acme and Featurn: Featurn is longer, so it is Featurn's, and on 10 January it is outside Featurn's window.
    await w.tx("2027-01-10", 121000, { counterparty: "Acme", description: "for Featurn project" });
    // Names Acme only: inside Acme's window.
    await w.tx("2027-01-11", 121000, { counterparty: "Acme", description: "project" });
    const s = await getBtwSummary(w.db, { today: TODAY });
    expect(s.received).toBe(121000);
    expect(s.owed).toBe(21000);
  });

  it("a 0% client's money adds nothing to what is owed or still to set aside", async () => {
    const w = await world();
    await w.globex("2026-12-01", 500000);
    const s = await getBtwSummary(w.db, { today: TODAY });
    expect(s).toMatchObject({ received: 500000, owed: 0, toSetAside: 0, hasData: true });
  });

  it("is complete only once the latest window has ended, and deleting a client changes it", async () => {
    const w = await world();
    // The third quarter, on 20 October: Featurn's window (July to September) has ended, Acme's (August to October) not,
    // Globex's (September to November) not.
    expect((await getBtwSummary(w.db, { today: "2026-10-20" })).complete).toBe(false);
    const [, acme, globex] = await w.clients();
    await deleteBtwClient(w.db, globex.id);
    const s = await getBtwSummary(w.db, { today: "2026-10-20" });
    expect(s.receipts).toEqual({ from: "2026-07-01", to: "2026-10-31" });
    expect(s.complete).toBe(false);
    await deleteBtwClient(w.db, acme.id);
    const t = await getBtwSummary(w.db, { today: "2026-10-20" });
    expect(t.receipts).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(t.complete).toBe(true);
  });

  it("deleting a client takes its money out", async () => {
    const w = await world();
    await w.featurn("2026-11-01", 121000);
    await w.acme("2026-11-01", 242000);
    expect((await getBtwSummary(w.db, { today: TODAY })).owed).toBe(63000);
    const [, acme] = await w.clients();
    await deleteBtwClient(w.db, acme.id);
    expect((await getBtwSummary(w.db, { today: TODAY })).owed).toBe(21000);
  });

  it("without any client: nothing is BTW income, and the window is the quarter itself", async () => {
    const w = await world();
    await w.featurn("2026-11-01", 121000);
    await replaceBtwClients(w.db, []);
    const s = await getBtwSummary(w.db, { today: TODAY });
    expect(s).toMatchObject({
      receipts: { from: "2026-10-01", to: "2026-12-31" },
      complete: true,
      received: 0,
      owed: 0,
      hasData: false,
    });
  });
});

describe("the monthly BTW share, the plan grid, Today's taxes and the forecast use each client's rate", () => {
  async function withItems() {
    const w = await world();
    const salary = await w.cat("Salaris / bijbaan");
    const item = (name: string, counterparty: string, amount: number) =>
      w.addItem({
        name,
        type: "income",
        matchCounterparty: counterparty,
        expectedAmount: amount,
        dayOfMonth: 5,
        startDate: "2027-02-01",
        categoryId: salary,
      });
    await item("Acme invoice", "ACME Ltd", 242000);
    await item("Globex invoice", "Globex GmbH", 500000);
    return w;
  }

  it("btwShareForMonth: turnover from every client, BTW only from the 21% ones", async () => {
    const w = await withItems();
    await w.featurn("2026-12-31", 242000);
    await w.globex("2026-12-01", 500000);
    expect(await btwShareForMonth(w.db, { month: "2026-12", today: TODAY })).toEqual({
      received: 742000,
      expected: 0,
      income: 742000,
      share: 42000,
    });
    // A later month: the fixed items expected in it.
    expect(await btwShareForMonth(w.db, { month: "2027-02", today: TODAY })).toEqual({
      received: 0,
      expected: 742000,
      income: 742000,
      share: 42000,
    });
  });

  it("the plan grid's BTW row and Today's taxes budget follow it", async () => {
    const w = await withItems();
    await w.globex("2027-01-05", 500000);
    await w.acme("2027-01-06", 121000);
    const plan = await loadPlan(w.db, TODAY, { months: 2, basis: "averages" });
    const cells = new Map(plan.sections.btw[0].cells.map((c) => [c.month, c.amount]));
    expect(cells.get("2027-01")).toBe(21000);
    expect(cells.get("2027-02")).toBe(42000);
    const taxes = await w.cat("Belastingen");
    const budgets = await getBudgetsByMonth(w.db, "2027-01", "2027-01", { btw: { today: TODAY } });
    expect(budgets.get("2027-01")!.btw.get(taxes)).toBe(21000);
  });

  it("the forecast builds up BTW only on the 21% clients' expected income", async () => {
    const w = await withItems();
    const forecast = await getForecast(w.db, { today: TODAY, months: 2, pastMonths: 0 });
    expect(forecast.months.map((m) => [m.month, m.btwAccrued])).toEqual([
      ["2027-01", 0],
      ["2027-02", 42000],
      ["2027-03", 42000],
    ]);
  });
});
