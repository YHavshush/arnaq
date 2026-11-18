import { describe, expect, it } from "vitest";
import { addBtwClient } from "@/lib/btw/clients";
import { btwShareForMonth } from "@/lib/btw/share";
import { getBudgetsByMonth, taxesCategoryId } from "@/lib/budget/budgets";
import { getMonthOverview } from "@/lib/budget/overview";
import { setup } from "@/lib/recurring/test-utils";
import { setIncomeTaxSettings } from "./settings";
import { incomeTaxShareForMonth } from "./share";
import { addIncomeTaxYear } from "./years";

const TODAY = "2026-10-11";

/**
 * Invented numbers. The test database has one client, Featurn, at 21%. In October Featurn paid 1,210.00 (1,000.00 plus
 * 210.00 BTW). Its invoice of 2,420.00 is a fixed income item on the 25th from October (2,000.00 without BTW).
 */
async function world() {
  const s = await setup();
  const income = await s.cat("Salaris / bijbaan");
  await s.tx("2026-10-05", 121000, { counterparty: "Featurn B.V." });
  await s.addItem({
    name: "Featurn invoice",
    type: "income",
    matchCounterparty: "Featurn B.V.",
    expectedAmount: 242000,
    dayOfMonth: 25,
    startDate: "2026-10-01",
    categoryId: income,
  });
  const share = (month: string) => incomeTaxShareForMonth(s.db, { month, today: TODAY });
  return { ...s, share };
}

describe("incomeTaxShareForMonth: the income tax to set aside for a month", () => {
  it("is the rate on the client income without the BTW inside it", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const btw = await btwShareForMonth(w.db, { month: "2026-10", today: TODAY });
    // October: 1,210.00 received plus 2,420.00 still expected; the BTW inside is 630.00.
    expect(btw).toMatchObject({ income: 363000, share: 63000 });
    expect(await w.share("2026-10")).toEqual({
      base: btw.income - btw.share,
      rate: 490,
      share: Math.round((300000 * 490) / 10000),
    });
    expect((await w.share("2026-10")).share).toBe(14700);
  });

  it("counts a 0% client's payment in full", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    await addBtwClient(w.db, { name: "Globex", vatPercent: 0 });
    await w.tx("2026-10-07", 60000, { counterparty: "Globex GmbH" });
    expect((await w.share("2026-10")).base).toBe(300000 + 60000);
  });

  it("rounds to whole cents each month", async () => {
    const s = await setup();
    await addIncomeTaxYear(s.db, { year: 2026, rate: 490 });
    await addBtwClient(s.db, { name: "Globex", vatPercent: 0 });
    // 123.45 at 4.9% is 6.04905: 6.05.
    await s.tx("2026-09-07", 12345, { counterparty: "Globex GmbH" });
    expect(await incomeTaxShareForMonth(s.db, { month: "2026-09", today: TODAY })).toEqual({
      base: 12345,
      rate: 490,
      share: 605,
    });
  });

  it("follows the BTW's received-versus-expected rules", async () => {
    const w = await world();
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    await w.tx("2026-09-05", 121000, { counterparty: "Featurn B.V." });
    // A month before today's: only what came in (the item starts in October anyway).
    expect((await w.share("2026-09")).base).toBe(100000);
    // A later month: only the item still expected.
    expect((await w.share("2026-11")).base).toBe(200000);
    expect((await w.share("2026-11")).share).toBe(9800);
    // Someone else's money is not client income.
    await w.tx("2026-09-20", 50000, { counterparty: "Werkgever" });
    expect((await w.share("2026-09")).base).toBe(100000);
  });

  it("is nothing for a year with no rate typed, with rate 0, and with the reserve off", async () => {
    const w = await world();
    expect(await w.share("2026-10")).toEqual({ base: 0, rate: 0, share: 0 });
    await addIncomeTaxYear(w.db, { year: 2027, rate: 650 });
    expect((await w.share("2026-10")).share).toBe(0);
    expect((await w.share("2027-01")).share).toBe(13000);
    await addIncomeTaxYear(w.db, { year: 2026, rate: 0 });
    expect((await w.share("2026-10")).share).toBe(0);
    await setIncomeTaxSettings(w.db, { on: false });
    expect((await w.share("2027-01")).share).toBe(0);
  });
});

describe("Today's taxes row", () => {
  it("holds the income tax share next to the BTW share, and counts the move into the pocket as set aside", async () => {
    const w = await world();
    const taxes = (await taxesCategoryId(w.db))!;
    const before = await getMonthOverview(w.db, "2026-10", { btw: { today: TODAY } });
    const row = (o: typeof before) => o.expenses.find((l) => l.categoryId === taxes)!;
    expect(row(before)).toMatchObject({ btw: 63000, incomeTax: 0, incomeTaxMoved: 0 });

    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    const budgets = (
      await getBudgetsByMonth(w.db, "2026-10", "2026-10", { btw: { today: TODAY } })
    ).get("2026-10")!;
    expect(budgets.incomeTax.get(taxes)).toBe(14700);
    expect(budgets.byCategory.get(taxes)).toBe(63000 + 14700);

    // 50.00 moved into the income tax pocket counts as set aside on the taxes row.
    const savings = await w.cat("Spaarrekening");
    await w.tx("2026-10-06", -5000, {
      counterparty: "To Inkomstenbelasting",
      categoryId: savings,
      isInternalTransfer: true,
    });
    const after = await getMonthOverview(w.db, "2026-10", { btw: { today: TODAY } });
    expect(row(after)).toMatchObject({
      btw: 63000,
      incomeTax: 14700,
      incomeTaxMoved: 5000,
      budget: 63000 + 14700,
      actual: row(before).actual + 5000,
    });
  });

  it("is unchanged with the reserve off, even with a year and a pocket move", async () => {
    const w = await world();
    const plain = await getMonthOverview(w.db, "2026-10", { btw: { today: TODAY } });
    await addIncomeTaxYear(w.db, { year: 2026, rate: 490 });
    await setIncomeTaxSettings(w.db, { on: false });
    await w.tx("2026-10-06", -5000, {
      counterparty: "To Inkomstenbelasting",
      categoryId: await w.cat("Spaarrekening"),
      isInternalTransfer: true,
    });
    const off = await getMonthOverview(w.db, "2026-10", { btw: { today: TODAY } });
    expect(off.expenses).toEqual(plain.expenses);
  });
});
