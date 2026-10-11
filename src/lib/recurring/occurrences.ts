import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { FREQUENCIES, OCCURRENCE_STATUSES, RECURRING_TYPES } from "@/db/schema";
import { addDays, addMonths, clampDay, isDate, isMonth, monthDiff, monthOf } from "./dates";
import { RecurringError } from "./errors";

export type Frequency = (typeof FREQUENCIES)[number];
export type RecurringType = (typeof RECURRING_TYPES)[number];
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

/** A payment counts for an occurrence up to this many days before or after its expected date. */
export const MATCH_WINDOW_DAYS = 5;

const STEP: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export interface Schedule {
  dayOfMonth: number;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
}

/**
 * Is there an occurrence in this month? Quarterly and yearly items are anchored at the
 * start month. The expected date (day clamped to the month) must lie within start..end.
 */
export function isScheduled(item: Schedule, month: string): boolean {
  const diff = monthDiff(monthOf(item.startDate), month);
  if (diff < 0 || diff % STEP[item.frequency] !== 0) return false;
  const date = clampDay(month, item.dayOfMonth);
  return date >= item.startDate && (item.endDate === null || date <= item.endDate);
}

export interface PlannedOccurrence {
  month: string;
  expectedDate: string;
}

/**
 * Pure: the occurrences an item has from its start through `throughMonth` (optionally only
 * from `fromMonth`). Does not touch the database, so the forecast can project with it too.
 */
export function planOccurrences(
  item: Schedule,
  opts: { throughMonth: string; fromMonth?: string },
): PlannedOccurrence[] {
  const out: PlannedOccurrence[] = [];
  const endMonth = item.endDate ? monthOf(item.endDate) : null;
  for (
    let m = monthOf(item.startDate);
    m <= opts.throughMonth && (endMonth === null || m <= endMonth);
    m = addMonths(m, STEP[item.frequency])
  ) {
    if (opts.fromMonth && m < opts.fromMonth) continue;
    if (isScheduled(item, m)) out.push({ month: m, expectedDate: clampDay(m, item.dayOfMonth) });
  }
  return out;
}

/**
 * Create the missing occurrences of every active item up to and including `throughMonth`.
 * Idempotent: existing occurrences (whatever their status) are never changed or duplicated.
 * Returns the number of occurrences created.
 */
export function generateOccurrences(db: Db, opts: { throughMonth: string }): number {
  if (!isMonth(opts.throughMonth))
    throw new RecurringError(`Invalid month "${opts.throughMonth}", use YYYY-MM.`);
  const items = db
    .select()
    .from(schema.recurringItems)
    .where(eq(schema.recurringItems.active, true))
    .all();
  let created = 0;
  for (const item of items) {
    for (const p of planOccurrences(item, { throughMonth: opts.throughMonth })) {
      created += db
        .insert(schema.recurringOccurrences)
        .values({
          recurringItemId: item.id,
          month: p.month,
          expectedDate: p.expectedDate,
          expectedAmount: item.expectedAmount,
        })
        .onConflictDoNothing({
          target: [schema.recurringOccurrences.recurringItemId, schema.recurringOccurrences.month],
        })
        .run().changes;
    }
  }
  return created;
}

/** Months with at least one upload (any account). */
function coveredMonths(db: Db): Set<string> {
  return new Set(
    db
      .selectDistinct({ month: schema.imports.month })
      .from(schema.imports)
      .all()
      .map((r) => r.month),
  );
}

/**
 * Flip `expected` occurrences to `missed` once their match window has fully passed
 * (expectedDate + MATCH_WINDOW_DAYS is before `today`) and every month the window touches
 * has been uploaded. Without an upload for that month we simply do not know yet, so we do
 * not cry wolf. A late payment can still match a missed occurrence (see matchOccurrences).
 * Returns the number of occurrences marked missed.
 */
export function markMissed(db: Db, opts: { today: string }): number {
  if (!isDate(opts.today))
    throw new RecurringError(`Invalid date "${opts.today}", use YYYY-MM-DD.`);
  const covered = coveredMonths(db);
  const open = db
    .select()
    .from(schema.recurringOccurrences)
    .where(eq(schema.recurringOccurrences.status, "expected"))
    .all();
  let n = 0;
  for (const o of open) {
    const windowStart = addDays(o.expectedDate, -MATCH_WINDOW_DAYS);
    const windowEnd = addDays(o.expectedDate, MATCH_WINDOW_DAYS);
    if (windowEnd >= opts.today) continue;
    if (!covered.has(monthOf(windowStart)) || !covered.has(monthOf(windowEnd))) continue;
    db.update(schema.recurringOccurrences)
      .set({ status: "missed" })
      .where(eq(schema.recurringOccurrences.id, o.id))
      .run();
    n++;
  }
  return n;
}

export interface OccurrenceView {
  id: number;
  recurringItemId: number;
  itemName: string;
  type: RecurringType;
  /** The recurring item's category (what the forecast should book it under). */
  categoryId: number | null;
  month: string;
  expectedDate: string;
  /** The plan, in positive cents. Never overwritten by a match. */
  expectedAmount: number;
  status: OccurrenceStatus;
  transactionId: number | null;
  /** Positive cents actually paid or received, when matched. */
  actualAmount: number | null;
  actualDate: string | null;
  /** What to count: the actual amount when matched, otherwise the expected amount. */
  amount: number;
}

export interface OccurrenceFilter {
  from?: string;
  to?: string;
  status?: OccurrenceStatus;
  recurringItemId?: number;
}

/**
 * Occurrences with their item and, when matched, the real amount from the transaction.
 * This is the read model for the recurring screen and the forecast.
 */
export function getOccurrences(db: Db, filter: OccurrenceFilter = {}): OccurrenceView[] {
  for (const m of [filter.from, filter.to]) {
    if (m !== undefined && !isMonth(m))
      throw new RecurringError(`Invalid month "${m}", use YYYY-MM.`);
  }
  if (filter.from && filter.to && filter.from > filter.to)
    throw new RecurringError("from must not be after to.");

  const o = schema.recurringOccurrences;
  const where: SQL[] = [];
  if (filter.from) where.push(gte(o.month, filter.from));
  if (filter.to) where.push(lte(o.month, filter.to));
  if (filter.status) where.push(eq(o.status, filter.status));
  if (filter.recurringItemId !== undefined)
    where.push(eq(o.recurringItemId, filter.recurringItemId));

  return db
    .select({
      o,
      item: schema.recurringItems,
      tx: { amount: schema.transactions.amount, date: schema.transactions.date },
    })
    .from(o)
    .innerJoin(schema.recurringItems, eq(schema.recurringItems.id, o.recurringItemId))
    .leftJoin(schema.transactions, eq(schema.transactions.id, o.transactionId))
    .where(and(...where))
    .orderBy(asc(o.month), asc(o.expectedDate), asc(o.recurringItemId))
    .all()
    .map(({ o, item, tx }) => {
      const matched = o.status === "matched" && tx !== null;
      // Matching only pairs same-sign transactions, so this is the positive amount.
      const actualAmount = matched ? (item.type === "expense" ? 0 - tx.amount : tx.amount) : null;
      return {
        id: o.id,
        recurringItemId: o.recurringItemId,
        itemName: item.name,
        type: item.type,
        categoryId: item.categoryId,
        month: o.month,
        expectedDate: o.expectedDate,
        expectedAmount: o.expectedAmount,
        status: o.status,
        transactionId: o.transactionId,
        actualAmount,
        actualDate: matched ? tx.date : null,
        amount: actualAmount ?? o.expectedAmount,
      };
    });
}

/** Missed occurrences for the review list, most recent first. */
export function getMissedOccurrences(db: Db): OccurrenceView[] {
  return getOccurrences(db, { status: "missed" }).sort(
    (a, b) => b.expectedDate.localeCompare(a.expectedDate) || a.id - b.id,
  );
}
