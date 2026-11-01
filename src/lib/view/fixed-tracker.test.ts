import { describe, expect, it } from "vitest";
import type { RecurringItem } from "@/lib/recurring/items";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { buildFixedTracker, historyMonths, trackerMonths } from "./fixed-tracker";

const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const TODAY = "2026-10-15";

let nextId = 1;
const item = (over: Partial<RecurringItem>): RecurringItem => ({
  id: nextId++,
  userId: "u",
  name: "Item",
  type: "expense",
  matchCounterparty: null,
  matchIban: null,
  expectedAmount: 1000,
  tolerance: 0,
  dayOfMonth: 5,
  frequency: "monthly",
  categoryId: null,
  startDate: "2026-01-01",
  endDate: null,
  active: true,
  ...over,
});

const occ = (it: RecurringItem, month: string, over: Partial<OccurrenceView> = {}): OccurrenceView => {
  const expectedDate = `${month}-${String(it.dayOfMonth).padStart(2, "0")}`;
  return {
    id: nextId++,
    recurringItemId: it.id,
    itemName: it.name,
    type: it.type,
    categoryId: it.categoryId,
    month,
    expectedDate,
    expectedAmount: it.expectedAmount,
    status: "expected",
    transactionId: null,
    actualAmount: null,
    actualDate: null,
    amount: it.expectedAmount,
    ...over,
  };
};

const paid = (it: RecurringItem, month: string, day: number, amount = it.expectedAmount) =>
  occ(it, month, {
    status: "matched",
    transactionId: nextId++,
    actualAmount: amount,
    actualDate: `${month}-${String(day).padStart(2, "0")}`,
    amount,
  });

const build = (items: RecurringItem[], occurrences: OccurrenceView[]) =>
  buildFixedTracker({ items, occurrences, months: MONTHS, today: TODAY });

describe("trackerMonths", () => {
  it("is 4 months back, the month itself and 2 ahead, across a year change", () => {
    expect(trackerMonths("2026-02")).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });
});

describe("historyMonths", () => {
  it("is the 5 months before the one on screen and the month itself, across a year change", () => {
    expect(historyMonths("2026-02")).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("buildFixedTracker", () => {
  it("shows paid, paid late (+Nd), missed and expected cells", () => {
    const rent = item({ name: "Rent", expectedAmount: 48100, dayOfMonth: 1, categoryId: 7 });
    const t = build(
      [rent],
      [
        paid(rent, "2026-07", 1),
        paid(rent, "2026-08", 4, 48150), // 3 days late, a different real amount
        occ(rent, "2026-09", { status: "missed" }),
        paid(rent, "2026-10", 1),
        occ(rent, "2026-11"),
        occ(rent, "2026-12"),
      ],
    );
    const cells = t.expenses.rows[0].cells;
    expect(cells.map((c) => c.kind)).toEqual(["paid", "late", "missed", "paid", "expected", "expected"]);
    expect(cells[0]).toMatchObject({ amount: 48100, lateDays: null, transactionMonth: "2026-07" });
    expect(cells[1]).toMatchObject({ amount: 48150, lateDays: 3, transactionMonth: "2026-08" });
    expect(cells[2]).toMatchObject({ amount: 48100, lateDays: null, transactionMonth: null });
    expect(cells[4]).toMatchObject({ amount: 48100, lateDays: null });
    expect(t.expenses.rows[0]).toMatchObject({ name: "Rent", categoryId: 7, active: true });
  });

  it("counts a payment before its expected date as paid, and the month it landed in", () => {
    const gym = item({ name: "Gym", dayOfMonth: 1 });
    const early = occ(gym, "2026-08", {
      status: "matched",
      transactionId: 99,
      actualAmount: 1000,
      actualDate: "2026-07-30",
      amount: 1000,
    });
    const cell = build([gym], [early]).expenses.rows[0].cells[1];
    expect(cell.kind).toBe("paid");
    expect(cell.transactionMonth).toBe("2026-07");
  });

  it("keeps income and expenses in separate tables", () => {
    const pay = item({ name: "Client", type: "income", expectedAmount: 96800, dayOfMonth: 20 });
    const rent = item({ name: "Rent" });
    const t = build([pay, rent], [paid(pay, "2026-10", 30), paid(rent, "2026-10", 5)]);
    expect(t.income.rows.map((r) => r.name)).toEqual(["Client"]);
    expect(t.expenses.rows.map((r) => r.name)).toEqual(["Rent"]);
    expect(t.income.rows[0].cells[3]).toMatchObject({ kind: "late", lateDays: 10, amount: 96800 });
  });

  it("leaves the cells before an item's start empty and plans the ones ahead that are not stored yet", () => {
    const newer = item({ name: "Netflix", startDate: "2026-09-10", dayOfMonth: 10, expectedAmount: 2100 });
    const t = build([newer], [paid(newer, "2026-09", 10), paid(newer, "2026-10", 10)]);
    expect(t.expenses.rows[0].cells.map((c) => c.kind)).toEqual([
      "none",
      "none",
      "paid",
      "paid",
      "expected", // November was not generated yet: planned from the item
      "expected",
    ]);
    expect(t.expenses.rows[0].cells[0]).toMatchObject({ amount: 0, lateDays: null });
    expect(t.expenses.rows[0].cells[4].amount).toBe(2100);
  });

  it("leaves months empty where a quarterly item has nothing", () => {
    const tax = item({ name: "Tax", frequency: "quarterly", startDate: "2026-01-15", dayOfMonth: 15 });
    const t = build([tax], [paid(tax, "2026-07", 15)]);
    expect(t.expenses.rows[0].cells.map((c) => c.kind)).toEqual([
      "paid",
      "none",
      "none",
      "expected", // October is a quarter month, not generated yet
      "none",
      "none",
    ]);
  });

  it("shows only what is stored for a paused item, and drops a paused item with nothing in range", () => {
    const paused = item({ name: "Old gym", active: false });
    const gone = item({ name: "Ancient", active: false });
    const t = build([paused, gone], [paid(paused, "2026-07", 5), paid(paused, "2026-08", 5)]);
    expect(t.expenses.rows.map((r) => r.name)).toEqual(["Old gym"]);
    const row = t.expenses.rows[0];
    expect(row.active).toBe(false);
    expect(row.cells.map((c) => c.kind)).toEqual(["paid", "paid", "none", "none", "none", "none"]);
  });

  it("totals: paid only for past months, real-or-plan this month, the plan for months ahead", () => {
    const a = item({ name: "A", expectedAmount: 1000 });
    const b = item({ name: "B", expectedAmount: 500 });
    const t = build(
      [a, b],
      [
        paid(a, "2026-07", 5, 1010),
        occ(b, "2026-07", { status: "missed" }), // missed: counts nothing in a past month
        paid(a, "2026-08", 5),
        paid(b, "2026-08", 5),
        occ(a, "2026-09", { status: "expected" }), // never matched, never flagged: not paid either
        paid(b, "2026-09", 5),
        paid(a, "2026-10", 5, 1020), // this month: real amount where paid
        occ(b, "2026-10"), // ... the plan otherwise
        occ(a, "2026-11"),
        occ(b, "2026-11"),
      ],
    );
    expect(t.expenses.totals).toEqual([
      1010, // July
      1500, // August
      500, // September
      1520, // October: 1020 real + 500 planned
      1500, // November: plans
      1500, // December: planned from the items
    ]);
  });

  it("agrees with the Fixed page for the current month: real amount where paid, plan (also when missed) otherwise", () => {
    const a = item({ name: "A", expectedAmount: 1000 });
    const b = item({ name: "B", expectedAmount: 500 });
    const occs = [paid(a, "2026-10", 5, 1020), occ(b, "2026-10", { status: "missed" })];
    const t = build([a, b], occs);
    const pageSum = occs.reduce((s, o) => s + o.amount, 0);
    expect(t.expenses.totals[3]).toBe(pageSum);
    expect(t.nowMonth).toBe("2026-10");
  });

  it("has no rows and zero totals when there are no items", () => {
    const t = build([], []);
    expect(t.income).toEqual({ rows: [], totals: [0, 0, 0, 0, 0, 0] });
    expect(t.expenses.rows).toEqual([]);
  });

  it("keeps the order of the items it is given", () => {
    const x = item({ name: "Zed" });
    const y = item({ name: "Alpha" });
    const t = build([x, y], [occ(x, "2026-10"), occ(y, "2026-10")]);
    expect(t.expenses.rows.map((r) => r.name)).toEqual(["Zed", "Alpha"]);
  });
});
