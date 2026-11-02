import { describe, expect, it } from "vitest";
import { btwShareForMonth } from "@/lib/btw/share";
import { setBudget } from "@/lib/budget/budgets";
import { setOwnSpending } from "@/lib/forecast/own";
import { setPlanOverride } from "@/lib/plan/overrides";
import { setup } from "@/lib/recurring/test-utils";
import { loadPrognose } from "./load";
import { loadPlan, type Plan, type PlanRow } from "./plan";

const TODAY = "2026-11-02";

/**
 * August to October uploaded with the bank's balances. Every month: groceries 300, eating out 150, transport 80,
 * clothing 60, sport 40, other 20, gifts 10 and 5 uncategorised. Fixed items from November: rent 1,000 on the 1st, a
 * phone subscription of 25 on the 15th (in Internet & telefoon), and the client's invoice of 2,420.00 on the 25th.
 */
async function world() {
  const s = await setup();
  const spend: [string, number][] = [
    ["Boodschappen", 30000],
    ["Eten & drinken", 15000],
    ["Vervoer", 8000],
    ["Kleding & verzorging", 6000],
    ["Sport", 4000],
    ["Overig", 2000],
    ["Cadeaus & donaties", 1000],
  ];
  const ids = new Map<string, number>();
  for (const [name] of spend) ids.set(name, await s.cat(name));
  await s.cover("2026-08", "2026-09", "2026-10");
  let balance = 600000;
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    for (const [i, [name, amount]] of spend.entries()) {
      balance -= amount;
      await s.tx(`${month}-${String(10 + i).padStart(2, "0")}`, -amount, {
        categoryId: ids.get(name),
        balanceAfter: balance,
      });
    }
    balance -= 500;
    await s.tx(`${month}-20`, -500, { balanceAfter: balance });
  }
  await s.tx("2026-11-02", -100, { categoryId: ids.get("Overig"), balanceAfter: balance - 100 });
  const rent = await s.addItem({
    name: "Huur",
    matchCounterparty: "Verhuurder",
    expectedAmount: 100000,
    dayOfMonth: 1,
    startDate: "2026-11-01",
    categoryId: await s.cat("Huur"),
  });
  const phone = await s.addItem({
    name: "Telefoon",
    matchCounterparty: "Provider",
    expectedAmount: 2500,
    dayOfMonth: 15,
    startDate: "2026-11-01",
    categoryId: await s.cat("Internet & telefoon"),
  });
  const invoice = await s.addItem({
    name: "Featurn invoice",
    type: "income",
    matchCounterparty: "Featurn B.V.",
    expectedAmount: 242000,
    dayOfMonth: 25,
    startDate: "2026-11-01",
    categoryId: await s.cat("Salaris / bijbaan"),
  });
  const type = (
    kind: "category" | "item",
    id: number,
    month: string,
    amount: number | null,
    scope: "month" | "after" = "month",
  ) => setPlanOverride(s.db, { kind, id, month, amount, scope }, TODAY);
  const plan = (basis: "averages" | "budget" | "own" = "averages", months = 4) =>
    loadPlan(s.db, TODAY, { months, basis });
  return { ...s, ids, rent, phone, invoice, type, plan };
}

const row = (rows: PlanRow[], key: string) => rows.find((r) => r.key === key)!;
const cell = (r: PlanRow, month: string) => r.cells.find((c) => c.month === month)!;
const total = (rows: PlanRow[], month: string) =>
  rows.reduce((s, r) => s + cell(r, month).amount, 0);

/** The footer is the Ahead chart's own numbers, and the rows add up to it. */
async function expectMatchesAhead(
  w: Awaited<ReturnType<typeof world>>,
  p: Plan,
  basis: "averages" | "budget" | "own",
  own: number | null = null,
) {
  const ahead = await loadPrognose(w.db, TODAY, p.months.length - 1, "en", basis, own);
  for (const f of p.footer) {
    const point = ahead.points.find((pt) => pt.month === f.month)!;
    expect(f, f.month).toEqual({
      month: f.month,
      income: point.income,
      expenses: point.expenses,
      growth: point.net,
      netWorth: point.cumulative,
      low: point.low,
    });
    expect(total(p.sections.income, f.month), `income ${f.month}`).toBe(f.income);
    expect(
      total(p.sections.fixed, f.month) + total(p.sections.variable, f.month),
      `expenses ${f.month}`,
    ).toBe(f.expenses);
    expect(total(p.allCategories, f.month)).toBe(total(p.sections.variable, f.month));
  }
}

describe("loadPlan", () => {
  it("has the current month and the months ahead, with the Ahead chart's numbers in the footer", async () => {
    const w = await world();
    const p = await w.plan();
    expect(p.months).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(p.currentMonth).toBe("2026-11");
    await expectMatchesAhead(w, p, "averages");
    expect(p.footer.every((f) => f.low !== null)).toBe(true);
  });

  it("matches the Ahead chart with typed cells, on every basis", async () => {
    const w = await world();
    await w.type("item", w.rent.id, "2027-01", 110000, "after");
    await w.type("item", w.invoice.id, "2026-12", 121000);
    await w.type("category", w.ids.get("Sport")!, "2026-11", 10000);
    await w.type("category", w.ids.get("Cadeaus & donaties")!, "2027-02", 50000);
    await setBudget(w.db, w.ids.get("Boodschappen")!, "2026-12", 20000);
    await expectMatchesAhead(w, await w.plan("averages"), "averages");
    await expectMatchesAhead(w, await w.plan("budget"), "budget");
    await setOwnSpending(w.db, 70000);
    await expectMatchesAhead(w, await w.plan("own"), "own", 70000);
  });

  it("income and fixed items: the item's own amount, or what was typed over it", async () => {
    const w = await world();
    await w.type("item", w.rent.id, "2027-01", 110000);
    await w.type("item", w.rent.id, "2027-02", 100000); // the same as the Fixed page: can be reset
    const p = await w.plan();
    const rent = row(p.sections.fixed, `item-${w.rent.id}`);
    expect(rent).toMatchObject({ kind: "item", id: w.rent.id, name: "Huur" });
    expect(cell(rent, "2026-12")).toMatchObject({
      amount: 100000,
      source: "item",
      suggestion: 100000,
      why: { type: "fixed" },
      redundant: false,
      editable: true,
      typed: null,
    });
    expect(cell(rent, "2027-01")).toMatchObject({
      amount: 110000,
      source: "typed",
      suggestion: 100000,
      redundant: false,
      typed: 110000,
    });
    expect(cell(rent, "2027-02")).toMatchObject({ source: "typed", redundant: true });
    expect(row(p.sections.income, `item-${w.invoice.id}`).cells.map((c) => c.amount)).toEqual([
      242000, 242000, 242000, 242000, 242000,
    ]);
  });

  it("the BTW row is computed from the client's income with btwShareForMonth and cannot be typed", async () => {
    const w = await world();
    await w.type("item", w.invoice.id, "2026-12", 121000);
    const p = await w.plan();
    const btw = row(p.sections.btw, "btw");
    expect(btw).toMatchObject({ kind: "btw", id: null });
    for (const c of btw.cells) {
      expect(c.source).toBe("computed");
      expect(c.editable).toBe(false);
      expect(c.amount).toBe((await btwShareForMonth(w.db, { month: c.month, today: TODAY })).share);
    }
    expect(cell(btw, "2026-12").amount).toBe(21000);
    expect(cell(btw, "2027-01").amount).toBe(42000);
  });

  it("categories: the suggestion and why, or what was typed; the current month includes what is already spent", async () => {
    const w = await world();
    const sport = w.ids.get("Sport")!;
    await w.type("category", sport, "2026-12", 10000);
    const p = await w.plan();
    const months = ["2026-08", "2026-09", "2026-10"];
    const groceries = row(p.allCategories, `category-${w.ids.get("Boodschappen")}`);
    expect(cell(groceries, "2026-12")).toMatchObject({
      amount: 30000,
      source: "suggestion",
      suggestion: 30000,
      why: { type: "average", months },
      editable: true,
    });
    const s = row(p.allCategories, `category-${sport}`);
    expect(cell(s, "2026-12")).toMatchObject({
      amount: 10000,
      source: "typed",
      suggestion: 4000,
      why: { type: "average", months },
      typed: 10000,
      redundant: false,
    });
    // November: Other has 1 spent so far and 20 expected in all.
    expect(cell(row(p.allCategories, `category-${w.ids.get("Overig")}`), "2026-11")).toMatchObject({
      amount: 2000,
      suggestion: 2000,
    });
  });

  it("with the budget basis says which budget a suggestion comes from", async () => {
    const w = await world();
    const groceries = w.ids.get("Boodschappen")!;
    await setBudget(w.db, groceries, "2026-12", 20000);
    const p = await w.plan("budget");
    const g = row(p.allCategories, `category-${groceries}`);
    expect(cell(g, "2026-11").why).toEqual({
      type: "average",
      months: ["2026-08", "2026-09", "2026-10"],
    });
    expect(cell(g, "2026-12")).toMatchObject({
      amount: 20000,
      why: { type: "budget", from: "2026-12" },
    });
    expect(cell(g, "2027-01")).toMatchObject({
      amount: 20000,
      why: { type: "carried", from: "2026-12" },
    });
    // A category whose only budget is its fixed items: nothing everyday on top.
    const phone = row(p.allCategories, `category-${await w.cat("Internet & telefoon")}`);
    expect(cell(phone, "2027-01")).toMatchObject({ amount: 0, why: { type: "fixed" } });
  });

  it("shows the five biggest, biggest first, and sums the rest in one row", async () => {
    const w = await world();
    const p = await w.plan();
    const keys = p.sections.variable.map((r) => r.key);
    expect(keys).toEqual([
      `category-${w.ids.get("Boodschappen")}`,
      `category-${w.ids.get("Eten & drinken")}`,
      `category-${w.ids.get("Vervoer")}`,
      `category-${w.ids.get("Kleding & verzorging")}`,
      `category-${w.ids.get("Sport")}`,
      "other",
    ]);
    const other = row(p.sections.variable, "other");
    // Rows the app makes up have no name: the screen labels them by key from its own catalog.
    expect(other).toMatchObject({ kind: "other", id: null, name: null });
    // Other (20), gifts (10) and the uncategorised 5 are in it.
    expect(cell(other, "2026-12")).toMatchObject({ amount: 3500, editable: false });
    expect(p.allCategories.length).toBeGreaterThan(keys.length);
  });

  it("a category with something typed in the months shown is always shown", async () => {
    const w = await world();
    const gifts = w.ids.get("Cadeaus & donaties")!;
    await w.type("category", gifts, "2027-03", 0);
    const p = await w.plan();
    const keys = p.sections.variable.map((r) => r.key);
    expect(keys).toContain(`category-${gifts}`);
    expect(keys).toContain(`category-${w.ids.get("Sport")}`);
    expect(keys).toHaveLength(7);
    // Typed beyond the months shown does not count.
    const short = await w.plan("averages", 2);
    expect(short.sections.variable.map((r) => r.key)).not.toContain(`category-${gifts}`);
  });

  it("never shows a past month and ignores what was typed for one", async () => {
    const w = await world();
    const before = await w.plan();
    await w.db.insert((await import("@/db")).schema.planOverrides).values({
      categoryId: w.ids.get("Boodschappen")!,
      month: "2026-10",
      amount: 1,
    });
    const after = await w.plan();
    expect(after).toEqual(before);
    expect(after.months[0]).toBe("2026-11");
  });

  it("refuses a horizon outside 1 to 24 months", async () => {
    const w = await world();
    await expect(w.plan("averages", 0)).rejects.toThrow();
    await expect(w.plan("averages", 25)).rejects.toThrow();
  });
});
