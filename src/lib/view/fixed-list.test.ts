import { describe, expect, it } from "vitest";
import type { RecurringItem } from "@/lib/recurring/items";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { buildFixedList } from "./fixed-list";
import { buildFixedTracker, historyMonths } from "./fixed-tracker";
import { buildVasteLasten } from "./vaste-lasten";

const MONTH = "2026-11";
const TODAY = "2026-11-02";

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

const occ = (
  it: RecurringItem,
  month: string,
  over: Partial<OccurrenceView> = {},
): OccurrenceView => ({
  id: nextId++,
  recurringItemId: it.id,
  itemName: it.name,
  type: it.type,
  categoryId: it.categoryId,
  month,
  expectedDate: `${month}-${String(it.dayOfMonth).padStart(2, "0")}`,
  expectedAmount: it.expectedAmount,
  status: "expected",
  transactionId: null,
  actualAmount: null,
  actualDate: null,
  amount: it.expectedAmount,
  ...over,
});

const paid = (it: RecurringItem, month: string, day: number, amount = it.expectedAmount) =>
  occ(it, month, {
    status: "matched",
    transactionId: nextId++,
    actualAmount: amount,
    actualDate: `${month}-${String(day).padStart(2, "0")}`,
    amount,
  });

function build(items: RecurringItem[], ranged: OccurrenceView[]) {
  const month = ranged.filter((o) => o.month === MONTH);
  const v = buildVasteLasten(month, "en");
  return buildFixedList({
    rows: [...v.expenses, ...v.income],
    items,
    history: buildFixedTracker({
      items,
      occurrences: ranged,
      months: historyMonths(MONTH),
      today: TODAY,
    }),
    missed: ranged.filter((o) => o.status === "missed"),
    month: MONTH,
  });
}

describe("buildFixedList", () => {
  it("gives every item one row with this month's state, in two sections with totals and progress", () => {
    const rent = item({ name: "Rent", expectedAmount: 48145, dayOfMonth: 1 });
    const gym = item({ name: "Gym", expectedAmount: 2000, dayOfMonth: 20 });
    const lazy = item({ name: "Lazy", expectedAmount: 3000, dayOfMonth: 3 });
    const job = item({ name: "Job", type: "income", expectedAmount: 96800, dayOfMonth: 14 });
    const list = build(
      [rent, gym, lazy, job],
      [
        paid(rent, "2026-10", 1),
        paid(rent, MONTH, 1),
        occ(gym, MONTH),
        occ(lazy, MONTH, { status: "missed" }),
        paid(job, MONTH, 24), // 10 days after the 14th
      ],
    );
    expect(list.expenses.rows.map((r) => [r.name, r.state])).toEqual([
      ["Lazy", "missed"], // what needs attention comes first
      ["Gym", "due"],
      ["Rent", "paid"],
    ]);
    expect(list.expenses.total).toBe(48145 + 2000 + 3000);
    expect([list.expenses.done, list.expenses.count]).toEqual([1, 3]);
    expect(list.income.rows[0]).toMatchObject({ name: "Job", state: "late", lateDays: 10 });
    expect([list.income.total, list.income.done, list.income.count]).toEqual([96800, 1, 1]);
  });

  it("carries the last 6 months as dots, oldest first, ending with the month on screen", () => {
    const rent = item({ name: "Rent", dayOfMonth: 1, startDate: "2026-07-01" });
    const list = build(
      [rent],
      [
        paid(rent, "2026-07", 1),
        paid(rent, "2026-08", 4),
        occ(rent, "2026-09", { status: "missed" }),
        paid(rent, "2026-10", 1),
        occ(rent, MONTH),
      ],
    );
    const h = list.expenses.rows[0].history;
    expect(h.map((c) => c.month)).toEqual(historyMonths(MONTH));
    // June: before the item started. Then paid, late, missed, paid, and this month still to come.
    expect(h.map((c) => c.kind)).toEqual(["none", "paid", "late", "missed", "paid", "expected"]);
  });

  it("a missed payment says missed on its row, with the date it was expected", () => {
    const gym = item({ name: "Gym", dayOfMonth: 3 });
    const list = build([gym], [occ(gym, MONTH, { status: "missed" })]);
    expect(list.expenses.rows[0]).toMatchObject({ state: "missed", date: "2026-11-03" });
    // Its own month is the row's state; it is not noted a second time as an earlier miss.
    expect(list.expenses.rows[0].missedEarlier).toBeNull();
  });

  it("notes a payment that went missing in an earlier month on the item's row", () => {
    const gym = item({ name: "Gym", dayOfMonth: 3 });
    const list = build(
      [gym],
      [
        occ(gym, "2026-09", { status: "missed" }),
        occ(gym, "2026-10", { status: "missed" }),
        occ(gym, MONTH),
      ],
    );
    expect(list.expenses.rows[0]).toMatchObject({ state: "due", missedEarlier: "2026-10-03" });
  });

  it("keeps items with nothing this month: active ones as 'off', paused ones as 'paused'", () => {
    const insurance = item({ name: "Insurance", frequency: "quarterly", startDate: "2026-01-01" });
    const old = item({ name: "Old", active: false });
    const list = build([insurance, old], []);
    expect(list.expenses.rows.map((r) => [r.name, r.state, r.date])).toEqual([
      ["Insurance", "off", null],
      ["Old", "paused", null],
    ]);
    // Nothing is due, so nothing counts toward the totals.
    expect([list.expenses.total, list.expenses.done, list.expenses.count]).toEqual([0, 0, 0]);
    expect(list.expenses.rows[0].amount).toBe(1000);
  });

  it("a paused item whose planned payment is still stored shows as paused, not as due", () => {
    const sub = item({ name: "Sub", active: false });
    const list = build([sub], [occ(sub, MONTH)]);
    expect(list.expenses.rows[0]).toMatchObject({ state: "paused", date: null });
  });

  it("is empty without items", () => {
    const list = build([], []);
    expect(list.expenses.rows).toEqual([]);
    expect(list.income.rows).toEqual([]);
  });
});
