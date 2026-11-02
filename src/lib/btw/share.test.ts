import { describe, expect, it } from "vitest";
import { getBudgetsByMonth, setBudget } from "@/lib/budget/budgets";
import { getMonthOverview } from "@/lib/budget/overview";
import { matchOccurrences } from "@/lib/recurring/matching";
import { generateOccurrences } from "@/lib/recurring/occurrences";
import { setup } from "@/lib/recurring/test-utils";
import { loadOverzicht } from "@/lib/view/load";
import { setBtwSettings } from "./settings";
import { btwShareForMonth, isClientItem } from "./share";

const TODAY = "2026-10-11";

async function world() {
  const s = await setup();
  const taxes = await s.cat("Belastingen");
  const savings = await s.cat("Spaarrekening");
  const salary = await s.cat("Salaris / bijbaan");
  const paid = (date: string, amount: number, extra = {}) =>
    s.tx(date, amount, { counterparty: "Featurn B.V.", ...extra });
  /** The client's monthly invoice as a fixed income item: 2,420.00 on the 25th. */
  const invoice = (extra = {}) =>
    s.addItem({
      name: "Featurn invoice",
      type: "income",
      matchCounterparty: "Featurn B.V.",
      expectedAmount: 242000,
      dayOfMonth: 25,
      startDate: "2026-01-01",
      categoryId: salary,
      ...extra,
    });
  return { ...s, taxes, savings, salary, paid, invoice };
}

describe("isClientItem", () => {
  it("matches the item's counterparty on whole words, and the name when no counterparty is set", () => {
    expect(isClientItem({ matchCounterparty: "FEATURN B.V.", name: "x" }, "Featurn")).toBe(true);
    expect(isClientItem({ matchCounterparty: "Featurnix", name: "Featurn" }, "Featurn")).toBe(
      false,
    );
    expect(isClientItem({ matchCounterparty: null, name: "Featurn invoice" }, "Featurn")).toBe(
      true,
    );
    expect(isClientItem({ matchCounterparty: "Werkgever", name: "Salary" }, "Featurn")).toBe(false);
  });
});

describe("btwShareForMonth: the BTW to set aside for a month, from the client's income", () => {
  it("the current month: 21/121 of what the client already paid plus what is still expected from them", async () => {
    const w = await world();
    await w.paid("2026-10-02", 121000);
    await w.invoice();
    const s = await btwShareForMonth(w.db, { month: "2026-10", today: TODAY });
    expect(s).toEqual({
      received: 121000,
      expected: 242000,
      income: 363000,
      share: 63000, // 363000 x 21 / 121
    });
  });

  it("rounds to whole cents", async () => {
    const w = await world();
    await w.paid("2026-10-02", 100001);
    expect((await btwShareForMonth(w.db, { month: "2026-10", today: TODAY })).share).toBe(17356);
  });

  it("leaves out other income, money out, internal transfers and foreign currency", async () => {
    const w = await world();
    await w.tx("2026-10-02", 50000, { counterparty: "Mum" });
    await w.paid("2026-10-03", -5000);
    await w.paid("2026-10-04", 70000, { isInternalTransfer: true });
    await w.paid("2026-10-05", 70000, { currency: "USD" });
    await w.addItem({
      name: "Salary",
      type: "income",
      matchCounterparty: "Werkgever",
      expectedAmount: 100000,
      dayOfMonth: 25,
      categoryId: w.salary,
    });
    expect(await btwShareForMonth(w.db, { month: "2026-10", today: TODAY })).toEqual({
      received: 0,
      expected: 0,
      income: 0,
      share: 0,
    });
  });

  it("does not count the client's invoice twice once it is paid and matched", async () => {
    const w = await world();
    const item = await w.invoice({ dayOfMonth: 5 });
    await w.paid("2026-10-05", 242000);
    await generateOccurrences(w.db, { throughMonth: "2026-10" });
    expect((await matchOccurrences(w.db)).matched).toBe(1);
    expect(item).toBeTruthy();
    expect(await btwShareForMonth(w.db, { month: "2026-10", today: TODAY })).toMatchObject({
      received: 242000,
      expected: 0,
      share: 42000,
    });
  });

  it("does not count it twice when the payment is in but not linked yet", async () => {
    const w = await world();
    await w.invoice({ dayOfMonth: 5 });
    await w.paid("2026-10-05", 242000);
    expect(await btwShareForMonth(w.db, { month: "2026-10", today: TODAY })).toMatchObject({
      received: 242000,
      expected: 0,
      share: 42000,
    });
  });

  it("a later month: only the invoices expected in it", async () => {
    const w = await world();
    await w.paid("2026-10-02", 121000);
    await w.invoice();
    await w.invoice({
      name: "Quarterly bonus",
      expectedAmount: 121000,
      frequency: "quarterly",
      startDate: "2026-12-01",
    });
    expect(await btwShareForMonth(w.db, { month: "2026-11", today: TODAY })).toEqual({
      received: 0,
      expected: 242000,
      income: 242000,
      share: 42000,
    });
    expect((await btwShareForMonth(w.db, { month: "2026-12", today: TODAY })).share).toBe(63000);
  });

  it("an earlier month: only what the client really paid (an invoice that never came adds nothing)", async () => {
    const w = await world();
    await w.invoice();
    await w.paid("2026-09-03", 60500);
    expect(await btwShareForMonth(w.db, { month: "2026-09", today: TODAY })).toEqual({
      received: 60500,
      expected: 0,
      income: 60500,
      share: 10500,
    });
  });

  it("ignores an invoice item that is switched off", async () => {
    const w = await world();
    await w.invoice({ active: false });
    expect((await btwShareForMonth(w.db, { month: "2026-11", today: TODAY })).share).toBe(0);
  });

  it("follows the client name the person saved", async () => {
    const w = await world();
    await setBtwSettings(w.db, { client: "Acme" });
    await w.paid("2026-10-02", 121000);
    await w.tx("2026-10-03", 121000, { counterparty: "ACME Consulting" });
    expect((await btwShareForMonth(w.db, { month: "2026-10", today: TODAY })).received).toBe(
      121000,
    );
  });
});

describe("the taxes budget with the BTW share (the Today screen)", () => {
  /** A monthly payment to the tax office of 20.00 as a fixed item in Taxes. */
  const instalment = (w: Awaited<ReturnType<typeof world>>) =>
    w.addItem({
      name: "Belastingdienst",
      matchCounterparty: "Belastingdienst",
      expectedAmount: 2000,
      dayOfMonth: 27,
      categoryId: w.taxes,
    });

  it("is the fixed tax items plus the month's BTW share", async () => {
    const w = await world();
    await instalment(w);
    await w.paid("2026-10-02", 121000);
    const b = (await getBudgetsByMonth(w.db, "2026-10", "2026-10", { btw: { today: TODAY } })).get(
      "2026-10",
    )!;
    expect(b.btw.get(w.taxes)).toBe(21000);
    expect(b.fixed.get(w.taxes)).toBe(2000);
    expect(b.byCategory.get(w.taxes)).toBe(23000);
  });

  it("a typed budget above it wins; one below it does not lower it", async () => {
    const w = await world();
    await instalment(w);
    await w.paid("2026-10-02", 121000);
    const taxesBudget = async () =>
      (await getBudgetsByMonth(w.db, "2026-10", "2026-10", { btw: { today: TODAY } }))
        .get("2026-10")!
        .byCategory.get(w.taxes);
    await setBudget(w.db, w.taxes, "2026-10", 30000);
    expect(await taxesBudget()).toBe(30000);
    await setBudget(w.db, w.taxes, "2026-10", 10000);
    expect(await taxesBudget()).toBe(23000);
  });

  it("is the share alone when there are no tax items, and no budget at all without either", async () => {
    const w = await world();
    await w.paid("2026-10-02", 121000);
    const oct = await getBudgetsByMonth(w.db, "2026-10", "2026-11", { btw: { today: TODAY } });
    expect(oct.get("2026-10")!.byCategory.get(w.taxes)).toBe(21000);
    expect(oct.get("2026-11")?.byCategory.get(w.taxes)).toBeUndefined();
  });

  it("is off unless asked for: the budget screens and the forecast see the plain budget", async () => {
    const w = await world();
    await instalment(w);
    await w.paid("2026-10-02", 121000);
    const plain = (await getBudgetsByMonth(w.db, "2026-10", "2026-10")).get("2026-10")!;
    expect(plain.byCategory.get(w.taxes)).toBe(2000);
    expect(plain.btw.size).toBe(0);
  });

  it("does not touch other categories", async () => {
    const w = await world();
    await w.paid("2026-10-02", 121000);
    await setBudget(w.db, await w.cat("Boodschappen"), "2026-10", 40000);
    const b = (await getBudgetsByMonth(w.db, "2026-10", "2026-10", { btw: { today: TODAY } })).get(
      "2026-10",
    )!;
    expect(b.byCategory.get(await w.cat("Boodschappen"))).toBe(40000);
    expect([...b.btw.keys()]).toEqual([w.taxes]);
  });

  it("the month overview carries it on the taxes line, with the share apart", async () => {
    const w = await world();
    await instalment(w);
    await w.paid("2026-10-02", 121000);
    const o = await getMonthOverview(w.db, "2026-10", { btw: { today: TODAY } });
    const line = o.expenses.find((l) => l.categoryId === w.taxes)!;
    expect(line).toMatchObject({ budget: 23000, fixed: 2000, btw: 21000, extra: null });
    // Without the option the line is as before.
    const plain = (await getMonthOverview(w.db, "2026-10")).expenses.find(
      (l) => l.categoryId === w.taxes,
    )!;
    expect(plain).toMatchObject({ budget: 2000, btw: 0 });
  });

  it("the Today screen's taxes row shows it", async () => {
    const w = await world();
    await instalment(w);
    await w.paid("2026-10-02", 121000);
    await w.invoice();
    const o = await loadOverzicht(w.db, "2026-10", TODAY, "en");
    const row = o.rows.find((r) => r.categoryId === w.taxes)!;
    // 2000 instalment + (121000 paid + 242000 expected) x 21 / 121.
    expect(row.budget).toBe(2000 + 63000);
  });
});

describe("the quarter's true-up: paying less than was set aside lowers that month's taxes budget", () => {
  const TODAY_JAN = "2027-01-28";
  async function q4(paidAmount: number | null) {
    const w = await world();
    // Q4: the client pays 1,000.00 a month, so 3 x 173.55 (rounded) is set aside; the quarter's BTW owed is 520.66.
    for (const d of ["2026-10-04", "2026-11-04", "2026-12-04"]) await w.paid(d, 100000);
    await w.paid("2027-01-04", 100000); // January's own income: its normal share is 173.55
    if (paidAmount !== null)
      await w.tx("2027-01-25", -paidAmount, {
        counterparty: "Belastingdienst",
        categoryId: w.taxes,
      });
    return w;
  }
  const share = async (db: Awaited<ReturnType<typeof world>>["db"], month: string) =>
    (await getBudgetsByMonth(db, month, month, { btw: { today: TODAY_JAN } })).get(month)?.btw;

  it("takes what was paid less than the quarter's BTW off the payment month's share, and only that month's", async () => {
    const w = await q4(40000); // owed 52066, paid 40000: 12066 less
    const taxes = w.taxes;
    expect((await share(w.db, "2027-01"))?.get(taxes)).toBe(17355 - 12066);
    expect((await share(w.db, "2026-12"))?.get(taxes)).toBe(17355); // other months stay as they were
    expect((await share(w.db, "2026-11"))?.get(taxes)).toBe(17355);
  });

  it("never goes below zero, and does not carry the rest to another month", async () => {
    const w = await q4(10000); // 42066 less than owed, more than January's share of 17355
    expect((await share(w.db, "2027-01"))?.get(w.taxes)).toBeUndefined(); // share 0: no BTW part at all
    expect((await share(w.db, "2027-02"))?.get(w.taxes)).toBeUndefined(); // no income in February in this world
  });

  it("changes nothing before the quarter is paid, or when it was paid in full or more", async () => {
    const before = await q4(null);
    expect((await share(before.db, "2027-01"))?.get(before.taxes)).toBe(17355);
    const full = await q4(60000); // more than owed
    expect((await share(full.db, "2027-01"))?.get(full.taxes)).toBe(17355);
  });
});

describe("moves into the BTW pocket count as set aside on the taxes row (the Today screen only)", () => {
  it("adds this month's net moves into the pocket to the taxes row's actual, and to the month's spending", async () => {
    const w = await world();
    await w.paid("2026-10-04", 100000);
    await w.tx("2026-10-05", -10000, {
      counterparty: "To EUR BTW",
      categoryId: w.savings,
      isInternalTransfer: true,
    });
    await w.tx("2026-10-09", 2000, {
      counterparty: "From EUR BTW",
      categoryId: w.savings,
      isInternalTransfer: true,
    });
    const plain = await getMonthOverview(w.db, "2026-10");
    const withBtw = await getMonthOverview(w.db, "2026-10", { btw: { today: TODAY } });
    const line = (o: typeof plain) => o.expenses.find((l) => l.categoryId === w.taxes)!;
    expect(line(plain).actual).toBe(0);
    expect(line(withBtw).actual).toBe(8000); // 100.00 in, 20.00 out
    expect(line(withBtw).remaining).toBe(line(withBtw).budget! - 8000);
    expect(withBtw.totals.expenseActual - plain.totals.expenseActual).toBe(8000);
  });
});

describe("the Today screen with the BTW share in the taxes budget", () => {
  async function home(movedIn: number) {
    const w = await world();
    await w.cover("2026-10");
    await w.paid("2026-10-04", 100000); // share: 17355
    if (movedIn > 0)
      await w.tx("2026-10-05", -movedIn, {
        counterparty: "To EUR BTW",
        categoryId: w.savings,
        isInternalTransfer: true,
      });
    return loadOverzicht(w.db, "2026-10", TODAY, "en");
  }

  it("the share is planned until it is moved into the pocket, then spent: free to spend does not change", async () => {
    const none = await home(0);
    const part = await home(8000);
    const all = await home(17355);
    const over = await home(30000); // more than this month's share: only the share counts
    expect(none.free).toBe(part.free);
    expect(none.free).toBe(all.free);
    expect(none.free).toBe(over.free);
    expect(none.planned - part.planned).toBe(8000);
    expect(none.planned - all.planned).toBe(17355);
    expect(part.spent - none.spent).toBe(8000);
    expect(over.spent - none.spent).toBe(17355);
  });
});
