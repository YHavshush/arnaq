import { schema, type Db } from "@/db";
import { addDays, addMonths, monthOf } from "@/lib/recurring/dates";
import { pairOccurrences, unmatchedCandidates } from "@/lib/recurring/matching";
import {
  MATCH_WINDOW_DAYS,
  getOccurrences,
  planOccurrences,
  type OccurrenceStatus,
  type OccurrenceView,
  type RecurringType,
} from "@/lib/recurring/occurrences";

/** How a month's totals include an occurrence. */
export type Counted =
  /** Not happened yet: added to the month as forecast money. */
  | "projected"
  /** Matched to a transaction dated in this month: already inside the month's actuals. */
  | "actual"
  /** Missed, matched to a payment in another month, or a past expectation: not in this month. */
  | "none";

export interface ForecastOccurrence {
  /** Null for an occurrence that is only planned (not stored in the database yet). */
  occurrenceId: number | null;
  source: "stored" | "planned";
  recurringItemId: number;
  name: string;
  type: RecurringType;
  categoryId: number | null;
  /** The occurrence's own month (differs from the listing month when carried over). */
  month: string;
  expectedDate: string;
  /** The plan, positive cents. */
  expectedAmount: number;
  status: OccurrenceStatus;
  transactionId: number | null;
  actualDate: string | null;
  /** Positive cents to show: the real amount when matched, otherwise the expected amount. */
  amount: number;
  /** An open occurrence of an earlier month that may still be paid this month. */
  carriedOver: boolean;
  counted: Counted;
}

type Line = Omit<ForecastOccurrence, "counted">;

export interface RecurringProjection {
  /** Occurrence lines per listing month (counted is decided per month kind, see countedAs). */
  byMonth: Map<string, Line[]>;
  /** Transactions that pay a planned occurrence in memory; they are not variable spend. */
  inMemoryMatched: Set<number>;
}

const key = (itemId: number, month: string) => `${itemId}:${month}`;

const fromStored = (o: OccurrenceView): Line => ({
  occurrenceId: o.id,
  source: "stored",
  recurringItemId: o.recurringItemId,
  name: o.itemName,
  type: o.type,
  categoryId: o.categoryId,
  month: o.month,
  expectedDate: o.expectedDate,
  expectedAmount: o.expectedAmount,
  status: o.status,
  transactionId: o.transactionId,
  actualDate: o.actualDate,
  amount: o.amount,
  carriedOver: false,
});

/**
 * All recurring occurrences relevant to the forecast window, read-only.
 *
 * - Stored occurrences (from the earliest listed month on) keep their status and amounts.
 *   An `expected` one of an inactive item is stale and ignored.
 * - From the current month on, every (active item, month) pair that planOccurrences schedules
 *   but that is not stored yet becomes a planned line: never two lines for one pair.
 * - A planned occurrence whose payment is already in the data (rent for the 1st paid on the
 *   28th) is matched in memory with the same rules as matchOccurrences, so it is not projected.
 * - An `expected` occurrence of an earlier month whose match window reaches into the current
 *   month is also listed (carriedOver) in the current month: it may still be paid there.
 */
export function projectRecurring(
  db: Db,
  w: { first: string; current: string; last: string },
): RecurringProjection {
  const items = db.select().from(schema.recurringItems).all();
  const active = new Set(items.filter((i) => i.active).map((i) => i.id));
  const previous = addMonths(w.current, -1);
  const stored = getOccurrences(db, {
    from: w.first < previous ? w.first : previous,
    to: w.last,
  }).filter((o) => o.status !== "expected" || active.has(o.recurringItemId));

  const byMonth = new Map<string, Line[]>();
  const add = (month: string, line: Line) => {
    const list = byMonth.get(month);
    if (list) list.push(line);
    else byMonth.set(month, [line]);
  };

  for (const o of stored) {
    const line = fromStored(o);
    if (o.month >= w.first) add(o.month, line);
    const windowEnd = addDays(o.expectedDate, MATCH_WINDOW_DAYS);
    if (o.month < w.current && o.status === "expected" && monthOf(windowEnd) >= w.current)
      add(w.current, { ...line, carriedOver: true });
  }

  const storedKeys = new Set(stored.map((o) => key(o.recurringItemId, o.month)));
  const { lines, inMemoryMatched } = plannedLines(db, items, storedKeys, w);
  for (const line of lines) add(line.month, line);

  for (const list of byMonth.values())
    list.sort(
      (a, b) =>
        a.expectedDate.localeCompare(b.expectedDate) ||
        a.recurringItemId - b.recurringItemId ||
        a.month.localeCompare(b.month),
    );
  return { byMonth, inMemoryMatched };
}

type Item = typeof schema.recurringItems.$inferSelect;

/**
 * Lines for every (active item, month) from the current month on that is scheduled but not
 * stored yet, with the ones already paid matched in memory.
 */
function plannedLines(
  db: Db,
  items: Item[],
  storedKeys: Set<string>,
  w: { current: string; last: string },
): { lines: Line[]; inMemoryMatched: Set<number> } {
  const planned = items
    .filter((i) => i.active)
    .flatMap((item) =>
      planOccurrences(item, { fromMonth: w.current, throughMonth: w.last })
        .filter((p) => !storedKeys.has(key(item.id, p.month)))
        .map((p) => ({ item, ...p })),
    );
  const paid = matchInMemory(db, planned);
  const inMemoryMatched = new Set([...paid.values()].map((t) => t.id));
  const lines = planned.map(({ item, month, expectedDate }, i): Line => {
    const t = paid.get(i);
    return {
      occurrenceId: null,
      source: "planned",
      recurringItemId: item.id,
      name: item.name,
      type: item.type,
      categoryId: item.categoryId,
      month,
      expectedDate,
      expectedAmount: item.expectedAmount,
      status: t ? "matched" : "expected",
      transactionId: t?.id ?? null,
      actualDate: t?.date ?? null,
      // Matching only pairs same-sign transactions, so this is the positive real amount.
      amount: t ? Math.abs(t.amount) : item.expectedAmount,
      carriedOver: false,
    };
  });
  return { lines, inMemoryMatched };
}

/** Planned index -> the unmatched transaction that already pays it (nothing is written). */
function matchInMemory(db: Db, planned: { item: Item; expectedDate: string }[]) {
  const paid = new Map<number, { id: number; amount: number; date: string }>();
  if (planned.length === 0) return paid;
  const dates = planned.map((p) => p.expectedDate).sort();
  const txs = unmatchedCandidates(
    db,
    addDays(dates[0], -MATCH_WINDOW_DAYS),
    addDays(dates[dates.length - 1], MATCH_WINDOW_DAYS),
  );
  if (txs.length === 0) return paid;
  const open = planned.map((p, i) => ({
    key: i,
    expectedDate: p.expectedDate,
    expectedAmount: p.item.expectedAmount,
    item: p.item,
  }));
  for (const { o, t } of pairOccurrences(open, txs)) paid.set(o.key, t);
  return paid;
}

/**
 * Decide how a line counts in the month it is listed under:
 * expected lines are forecast money from the current month on (never in the past: a past month
 * shows actuals only); a matched line is actual money only in the month its payment is dated
 * (and only where that month shows actuals); missed lines never count.
 */
export function countedAs(
  line: Line,
  month: string,
  kind: "actual" | "no-data" | "mixed" | "forecast",
): Counted {
  if (line.status === "expected")
    return kind === "mixed" || kind === "forecast" ? "projected" : "none";
  if (line.status === "matched")
    return (kind === "actual" || kind === "mixed") && line.actualDate?.slice(0, 7) === month
      ? "actual"
      : "none";
  return "none";
}
