import { addMonths, daysBetween, monthOf } from "@/lib/recurring/dates";
import type { RecurringItem } from "@/lib/recurring/items";
import { isScheduled, type OccurrenceView } from "@/lib/recurring/occurrences";

/** The months of the tracker around the one on screen: 4 before it, it, and 2 after. */
export const TRACKER_MONTHS_BEFORE = 4;
export const TRACKER_MONTHS_AFTER = 2;

export function trackerMonths(anchor: string): string[] {
  const out: string[] = [];
  for (let i = -TRACKER_MONTHS_BEFORE; i <= TRACKER_MONTHS_AFTER; i++)
    out.push(addMonths(anchor, i));
  return out;
}

/** The history under each fixed item on the Fixed page: this many months, ending with the one on screen. */
export const HISTORY_MONTHS = 6;

export function historyMonths(anchor: string): string[] {
  return Array.from({ length: HISTORY_MONTHS }, (_, i) =>
    addMonths(anchor, i + 1 - HISTORY_MONTHS),
  );
}

/**
 * - paid: matched on or before its expected date
 * - late: matched after its expected date (`lateDays` says how many days)
 * - missed: no payment found (also bounced)
 * - expected: still to come, shown at the plan
 * - none: the item has nothing in this month (not started yet, ended, paused, or not its quarter)
 */
export type TrackerCellKind = "paid" | "late" | "missed" | "expected" | "none";

export interface TrackerCell {
  month: string;
  kind: TrackerCellKind;
  /** Positive cents: what was paid for paid/late, otherwise the plan. 0 for "none". */
  amount: number;
  /** Days after the expected date, for "late" only. */
  lateDays: number | null;
  /** The month of the linked transaction, for paid/late: where to look it up. */
  transactionMonth: string | null;
}

export interface TrackerRow {
  itemId: number;
  name: string;
  categoryId: number | null;
  active: boolean;
  cells: TrackerCell[];
}

export interface TrackerTable {
  rows: TrackerRow[];
  /** One total per month, in the order of `FixedTracker.months`. */
  totals: number[];
}

export interface FixedTracker {
  months: string[];
  /** Today's month: the one whose column is "now" (may lie outside `months`). */
  nowMonth: string;
  income: TrackerTable;
  expenses: TrackerTable;
}

function cellOf(o: OccurrenceView, month: string): TrackerCell {
  if (o.status === "matched" && o.actualAmount !== null) {
    const lateDays = o.actualDate ? Math.max(0, daysBetween(o.expectedDate, o.actualDate)) : 0;
    return {
      month,
      kind: lateDays > 0 ? "late" : "paid",
      amount: o.actualAmount,
      lateDays: lateDays > 0 ? lateDays : null,
      transactionMonth: monthOf(o.actualDate ?? o.expectedDate),
    };
  }
  return {
    month,
    kind: o.status === "missed" ? "missed" : "expected",
    amount: o.expectedAmount,
    lateDays: null,
    transactionMonth: null,
  };
}

const none = (month: string): TrackerCell => ({
  month,
  kind: "none",
  amount: 0,
  lateDays: null,
  transactionMonth: null,
});

/**
 * Pure view model for the Fixed tracker: one row per fixed item, one cell per month.
 * Stored occurrences win. An active item with no stored occurrence in a month it is scheduled
 * for (months ahead that were not generated yet) shows as expected at its plan. A paused item
 * only shows what is already stored.
 *
 * Totals per month: past months count what was really paid, months ahead the plan, and the
 * current month the real amount where paid and the plan otherwise. That last rule is the same
 * as the sums on the Fixed page ("Left after fixed costs"), so the two always agree.
 */
export function buildFixedTracker(input: {
  items: RecurringItem[];
  occurrences: OccurrenceView[];
  months: string[];
  today: string;
}): FixedTracker {
  const { items, occurrences, months, today } = input;
  const nowMonth = monthOf(today);
  const byKey = new Map<string, OccurrenceView>();
  for (const o of occurrences) byKey.set(`${o.recurringItemId}|${o.month}`, o);

  const table = (type: "income" | "expense"): TrackerTable => {
    const rows: TrackerRow[] = [];
    for (const item of items) {
      if (item.type !== type) continue;
      const cells = months.map((month) => {
        const stored = byKey.get(`${item.id}|${month}`);
        if (stored) return cellOf(stored, month);
        if (item.active && isScheduled(item, month)) {
          return {
            month,
            kind: "expected" as const,
            amount: item.expectedAmount,
            lateDays: null,
            transactionMonth: null,
          };
        }
        return none(month);
      });
      if (cells.every((c) => c.kind === "none")) continue;
      rows.push({
        itemId: item.id,
        name: item.name,
        categoryId: item.categoryId,
        active: item.active,
        cells,
      });
    }
    const totals = months.map((month, i) => {
      let sum = 0;
      for (const row of rows) {
        const c = row.cells[i];
        if (c.kind === "none") continue;
        const real = c.kind === "paid" || c.kind === "late";
        if (month < nowMonth) sum += real ? c.amount : 0;
        else sum += c.amount; // this month and ahead: actual where paid, the plan otherwise
      }
      return sum;
    });
    return { rows, totals };
  };

  return { months, nowMonth, income: table("income"), expenses: table("expense") };
}
