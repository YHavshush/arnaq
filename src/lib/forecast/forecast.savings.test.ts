import { describe, expect, it } from "vitest";
import { createRecurringItem, RecurringError } from "@/lib/recurring/items";
import { matchOccurrences } from "@/lib/recurring/matching";
import { generateOccurrences } from "@/lib/recurring/occurrences";
import { setSavingsAnchor } from "@/lib/savings/settings";
import { setup } from "@/lib/recurring/test-utils";
import { buildPrognose } from "@/lib/view/prognose";
import { getForecast } from "./forecast";

const TODAY = "2026-10-11";
const reserve = {
  name: "BTW reserve",
  matchCounterparty: "EUR BTW",
  expectedAmount: 50000,
  tolerance: 0,
  dayOfMonth: 5,
  startDate: "2026-01-01",
};

describe("a fixed item that sets money aside (category Savings)", () => {
  it("is accepted as an outgoing item, but never as income", async () => {
    const { db, cat } = await setup();
    const savings = await cat("Spaarrekening");
    const item = await createRecurringItem(
      db,
      { ...reserve, type: "expense", categoryId: savings },
      { today: TODAY },
    );
    expect(item.categoryId).toBe(savings);
    await expect(
      createRecurringItem(
        db,
        { ...reserve, type: "income", categoryId: savings },
        { today: TODAY },
      ),
    ).rejects.toBeInstanceOf(RecurringError);
  });
});

describe("getForecast: money set aside", () => {
  it("counts a planned deposit as set aside: not spending, not uncategorised, but less money left", async () => {
    const { db, addItem, cat, tx, cover } = await setup();
    await cover("2026-09");
    await tx("2026-09-10", -2000, { balanceAfter: 300000, counterparty: "Shop" });
    await addItem({ ...reserve, type: "expense", categoryId: await cat("Spaarrekening") });
    const f = await getForecast(db, { today: TODAY, months: 3, pastMonths: 1 });
    const future = f.months.filter((m) => m.kind === "forecast");
    expect(future).toHaveLength(3);
    for (const m of future) {
      expect(m.setAside).toEqual({ actual: 0, planned: 50000, total: 50000 });
      expect(m.recurring.expenses).toBe(0);
      expect(m.expenses).toBe(m.variable); // only the everyday average, nothing from the deposit
      expect(m.categories.find((c) => c.categoryId === null)?.recurring).toBe(0);
    }
    expect(future.map((m) => m.cumulativeSetAside)).toEqual([100000, 150000, 200000]);
  });

  it("does not count the planned deposit twice once the deposit has happened this month", async () => {
    const { db, addItem, cat, tx, cover } = await setup();
    await cover("2026-10");
    const savings = await cat("Spaarrekening");
    await addItem({ ...reserve, type: "expense", categoryId: savings });
    await tx("2026-10-06", -50000, {
      counterparty: "To EUR BTW",
      categoryId: savings,
      categorySource: "rule",
      isInternalTransfer: true,
    });
    const f = await getForecast(db, { today: TODAY, months: 1, pastMonths: 0 });
    const current = f.months[0];
    expect(current.setAside).toEqual({ actual: 50000, planned: 0, total: 50000 });
    const next = f.months[1];
    expect(next.setAside.planned).toBe(50000);
  });

  it("shows money that really went into and out of savings in past months", async () => {
    const { db, tx, cat, cover } = await setup();
    await cover("2026-08", "2026-09");
    const savings = await cat("Spaarrekening");
    const move = (date: string, amount: number) =>
      tx(date, amount, { categoryId: savings, isInternalTransfer: true, counterparty: "Spaar" });
    await move("2026-08-03", -30000);
    await move("2026-09-03", 5000);
    const f = await getForecast(db, { today: TODAY, months: 1, pastMonths: 2 });
    expect(f.months.slice(0, 2).map((m) => m.setAside.actual)).toEqual([30000, -5000]);
    expect(f.months.slice(0, 2).map((m) => m.cumulativeSetAside)).toEqual([30000, 25000]);
  });

  it("leaves other items and the variable average alone", async () => {
    const { db, addItem, cat } = await setup();
    await addItem({
      name: "Huur",
      matchCounterparty: "Verhuurder",
      expectedAmount: 80000,
      dayOfMonth: 1,
      categoryId: await cat("Huur"),
    });
    const f = await getForecast(db, { today: TODAY, months: 1, pastMonths: 0 });
    expect(f.months[1].recurring.expenses).toBe(80000);
    expect(f.months[1].setAside).toEqual({ actual: 0, planned: 0, total: 0 });
  });
});

describe("matching a deposit item", () => {
  it("pairs the item with a savings move, and only with that", async () => {
    const { db, addItem, cat, tx, occ } = await setup();
    const savings = await cat("Spaarrekening");
    const item = await addItem({ ...reserve, type: "expense", categoryId: savings });
    const deposit = await tx("2026-10-06", -50000, {
      counterparty: "To EUR BTW",
      categoryId: savings,
      isInternalTransfer: true,
    });
    const plain = await tx("2026-10-05", -50000, { counterparty: "EUR BTW" });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await matchOccurrences(db);
    expect(await occ(item!.id, "2026-10")).toMatchObject({
      status: "matched",
      transactionId: deposit!.id,
    });
    expect(plain!.id).not.toBe(deposit!.id);
  });

  it("keeps the match when run again (a savings move is not released as an internal transfer)", async () => {
    const { db, addItem, cat, tx, occ } = await setup();
    const savings = await cat("Spaarrekening");
    const item = await addItem({ ...reserve, type: "expense", categoryId: savings });
    await tx("2026-10-06", -50000, {
      counterparty: "To EUR BTW",
      categoryId: savings,
      isInternalTransfer: true,
    });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await matchOccurrences(db);
    const again = await matchOccurrences(db);
    expect(again.unlinked).toBe(0);
    expect((await occ(item!.id, "2026-10")).status).toBe("matched");
  });

  it("a normal item still never takes an internal transfer", async () => {
    const { db, addItem, tx, occ } = await setup();
    const item = await addItem({ ...reserve, type: "expense", categoryId: null });
    await tx("2026-10-06", -50000, { counterparty: "To EUR BTW", isInternalTransfer: true });
    await generateOccurrences(db, { throughMonth: "2026-10" });
    await matchOccurrences(db);
    expect((await occ(item!.id, "2026-10")).status).not.toBe("matched");
  });
});

describe("net worth over time with money set aside", () => {
  async function world() {
    const { db, addItem, cat, tx, cover } = await setup();
    await cover("2026-09");
    await tx("2026-09-10", -2000, { balanceAfter: 300000, counterparty: "Shop" });
    await setSavingsAnchor(db, { amount: 100000, asOf: "2026-09-30" });
    await addItem({ ...reserve, type: "expense", categoryId: await cat("Spaarrekening") });
    return getForecast(db, { today: TODAY, months: 2, pastMonths: 1 });
  }

  it("the line is accounts plus savings: a deposit moves money between them, it does not lower net worth", async () => {
    const p = buildPrognose(await world(), "en");
    const [september, october, november] = p.points;
    expect(p.hasBalance).toBe(true);
    expect(october.cumulative).toBe(september.cumulative + october.net);
    expect(november.cumulative).toBe(october.cumulative + november.net);
    expect(september.accounts + september.savings).toBe(september.cumulative);
    expect(october.accounts + october.savings).toBe(october.cumulative);
  });

  it("the deposit leaves the accounts and arrives in savings", async () => {
    const p = buildPrognose(await world(), "en");
    const [september, october, november] = p.points;
    expect(october.savings).toBe(september.savings + 50000);
    expect(november.savings).toBe(october.savings + 50000);
    expect(october.accounts).toBe(september.accounts + october.net - 50000);
    expect(november.setAside).toBe(50000);
    expect(p.notes.some((n) => /aside|opzij/i.test(n))).toBe(true);
  });

  it("starts from the savings the statement reported", async () => {
    const f = await world();
    expect(f.openingSavings).toBe(100000);
    expect(f.openingBalance).toBe(302000); // the balance before the September shop
  });

  it("without any savings known the line is just the accounts, as before", async () => {
    const { db, tx, cover } = await setup();
    await cover("2026-09");
    await tx("2026-09-10", -2000, { balanceAfter: 300000, counterparty: "Shop" });
    const f = await getForecast(db, { today: TODAY, months: 1, pastMonths: 1 });
    expect(f.openingSavings).toBeNull();
  });
});
