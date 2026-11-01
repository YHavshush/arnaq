import type { RecurringItem } from "@/lib/recurring/items";
import type { FixedTracker, TrackerCell } from "./fixed-tracker";
import type { VasteLastRow } from "./vaste-lasten";

/**
 * What one fixed item looks like this month.
 * - paid / late: matched (late: after its expected date)
 * - due: still to come
 * - missed: no payment found
 * - paused: switched off (nothing is expected)
 * - off: active, but nothing falls in this month (a quarterly or yearly item, or not started)
 */
export type RowState = "paid" | "late" | "due" | "missed" | "paused" | "off";

export interface FixedListRow {
  itemId: number;
  name: string;
  categoryId: number | null;
  type: "expense" | "income";
  active: boolean;
  frequency: "monthly" | "quarterly" | "yearly";
  dayOfMonth: number;
  /** Positive cents: what was paid, or this month's plan, or the item's usual amount when nothing is due. */
  amount: number;
  state: RowState;
  /** The day it was paid, or is expected; null when `state` has no date. */
  date: string | null;
  lateDays: number | null;
  /** Expected date of the latest payment of this item that went missing in another month, if any. */
  missedEarlier: string | null;
  /** The last months up to and including the one on screen, oldest first. */
  history: TrackerCell[];
}

export interface FixedListSection {
  type: "expense" | "income";
  rows: FixedListRow[];
  /** Cents of the month's rows: the real amount where paid, the plan otherwise. */
  total: number;
  /** Rows paid (expenses) or in (income). */
  done: number;
  /** Rows the month has (those with nothing due this month are not counted). */
  count: number;
}

export interface FixedList {
  expenses: FixedListSection;
  income: FixedListSection;
}

/**
 * Pure view model for the Fixed list: one row per fixed item, in two sections.
 * `rows` are the month's occurrences in the order to show them (what still needs paying first);
 * items with nothing in the month follow them.
 */
export function buildFixedList(input: {
  rows: VasteLastRow[];
  items: RecurringItem[];
  /** A tracker whose last column is the month on screen. */
  history: FixedTracker;
  /** Every missed occurrence (any month); those outside `month` are noted on their item's row. */
  missed: { recurringItemId: number; month: string; expectedDate: string }[];
  month: string;
}): FixedList {
  const { rows, items, history, missed, month } = input;
  const missedBefore = new Map<number, string>();
  for (const o of missed) {
    if (o.month === month) continue; // that one is the row's own state
    const known = missedBefore.get(o.recurringItemId);
    if (!known || o.expectedDate > known) missedBefore.set(o.recurringItemId, o.expectedDate);
  }
  const itemById = new Map(items.map((it) => [it.id, it]));
  const historyOf = new Map<number, TrackerCell[]>();
  for (const table of [history.expenses, history.income])
    for (const r of table.rows) historyOf.set(r.itemId, r.cells);
  const emptyHistory = (): TrackerCell[] =>
    history.months.map((m) => ({
      month: m,
      kind: "none",
      amount: 0,
      lateDays: null,
      transactionMonth: null,
    }));
  const cellFor = (id: number) => historyOf.get(id)?.find((c) => c.month === month) ?? null;

  const fromOccurrence = (r: VasteLastRow): FixedListRow => {
    const item = itemById.get(r.itemId);
    const cell = cellFor(r.itemId);
    const late = r.status === "matched" && cell?.kind === "late";
    const state: RowState =
      r.status === "matched"
        ? late
          ? "late"
          : "paid"
        : r.status === "missed"
          ? "missed"
          : item && !item.active
            ? "paused"
            : "due";
    return {
      itemId: r.itemId,
      name: r.name,
      categoryId: r.categoryId,
      type: r.type,
      active: item?.active ?? true,
      frequency: item?.frequency ?? "monthly",
      dayOfMonth: item?.dayOfMonth ?? Number(r.date.slice(8, 10)),
      amount: r.amount,
      state,
      date: state === "paused" ? null : r.date,
      lateDays: late ? (cell?.lateDays ?? null) : null,
      missedEarlier: missedBefore.get(r.itemId) ?? null,
      history: historyOf.get(r.itemId) ?? emptyHistory(),
    };
  };

  const withRow = new Set(rows.map((r) => r.itemId));
  const quiet = (type: "expense" | "income"): FixedListRow[] =>
    items
      .filter((it) => it.type === type && !withRow.has(it.id))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map((it) => ({
        itemId: it.id,
        name: it.name,
        categoryId: it.categoryId,
        type: it.type,
        active: it.active,
        frequency: it.frequency,
        dayOfMonth: it.dayOfMonth,
        amount: it.expectedAmount,
        state: it.active ? ("off" as const) : ("paused" as const),
        date: null,
        lateDays: null,
        missedEarlier: missedBefore.get(it.id) ?? null,
        history: historyOf.get(it.id) ?? emptyHistory(),
      }));

  const section = (type: "expense" | "income"): FixedListSection => {
    const own = rows.filter((r) => r.type === type);
    return {
      type,
      rows: [...own.map(fromOccurrence), ...quiet(type)],
      total: own.reduce((s, r) => s + r.amount, 0),
      done: own.filter((r) => r.status === "matched").length,
      count: own.length,
    };
  };

  return { expenses: section("expense"), income: section("income") };
}
