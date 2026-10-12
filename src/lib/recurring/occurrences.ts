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

/**
 * Like isScheduled, but only at month granularity: ignores the day of month, so a start date
 * in the middle of a month does not exclude that month. Used to decide whether past, unmatched
 * history still belongs to the item after an edit.
 */
export function isScheduledMonth(item: Schedule, month: string): boolean {
  const diff = monthDiff(monthOf(item.startDate), month);
  if (diff < 0 || diff % STEP[item.frequency] !== 0) return false;
  return item.endDate === null || month <= monthOf(item.endDate);
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
export async function generateOccurrences(db: Db, opts: { throughMonth: string }): Promise<number> {
  if (!isMonth(opts.throughMonth))
    throw new RecurringError(`Invalid month "${opts.throughMonth}", use YYYY-MM.`);
  const items = await db
    .select()
    .from(schema.recurringItems)
    .where(eq(schema.recurringItems.active, true));
  const planned = items.flatMap((item) =>
    planOccurrences(item, { throughMonth: opts.throughMonth }).map((p) => ({
      recurringItemId: item.id,
      month: p.month,
      expectedDate: p.expectedDate,
      expectedAmount: item.expectedAmount,
    })),
  );
  // Chunked multi-row inserts: one round trip per 500 instead of one per occurrence.
  let created = 0;
  for (let i = 0; i < planned.length; i += 500) {
    created += (
      await db
        .insert(schema.recurringOccurrences)
        .values(planned.slice(i, i + 500))
        .onConflictDoNothing({
          target: [schema.recurringOccurrences.recurringItemId, schema.recurringOccurrences.month],
        })
        .returning({ id: schema.recurringOccurrences.id })
    ).length;
  }
  return created;
}

/**
 * Months we hold complete data for.
 * - An upload that declares its period (a PDF statement, a Revolut file name) covers every month
 *   that lies fully inside it. Periods of one account that touch or overlap are joined first, so
 *   two consecutive statements together cover the month they share. A partly covered month is not
 *   covered: we would otherwise show a half-empty month as real.
 * - An upload without a declared period (a plain CSV) covers its `month`.
 * Any account counts; two uploads of one month count once.
 */
export async function coveredMonths(db: Db): Promise<Set<string>> {
  const imports = await db
    .select({
      accountId: schema.imports.accountId,
      month: schema.imports.month,
      from: schema.imports.periodFrom,
      to: schema.imports.periodTo,
    })
    .from(schema.imports);
  const covered = new Set<string>();
  const byAccount = new Map<number, { from: string; to: string }[]>();
  for (const i of imports) {
    if (i.from === null || i.to === null) covered.add(i.month);
    else
      byAccount.set(i.accountId, [
        ...(byAccount.get(i.accountId) ?? []),
        { from: i.from, to: i.to },
      ]);
  }
  for (const periods of byAccount.values()) {
    const merged: { from: string; to: string }[] = [];
    for (const p of periods.sort((a, b) => a.from.localeCompare(b.from))) {
      const last = merged.at(-1);
      if (last && p.from <= addDays(last.to, 1)) last.to = p.to > last.to ? p.to : last.to;
      else merged.push({ ...p });
    }
    for (const { from, to } of merged) {
      for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) {
        if (`${m}-01` >= from && clampDay(m, 31) <= to) covered.add(m);
      }
    }
  }
  return covered;
}

/**
 * Flip `expected` occurrences to `missed` once their match window has fully passed
 * (expectedDate + MATCH_WINDOW_DAYS is before `today`) and we hold the data to judge it:
 * the occurrence's own month must be uploaded, and so must the month the window reaches into
 * after it. A window reaching back into a month before the very first upload counts as
 * covered (there is nothing earlier to upload), so rent on the 1st is judged normally for the
 * first uploaded month. Without an upload for the months that matter we simply do not know
 * yet, so we do not cry wolf. A late payment can still match a missed occurrence (see matchOccurrences).
 * Returns the number of occurrences marked missed.
 */
export async function markMissed(db: Db, opts: { today: string }): Promise<number> {
  if (!isDate(opts.today))
    throw new RecurringError(`Invalid date "${opts.today}", use YYYY-MM-DD.`);
  const covered = await coveredMonths(db);
  const firstUpload = [...covered].sort()[0] ?? "";
  const open = await db
    .select()
    .from(schema.recurringOccurrences)
    .where(eq(schema.recurringOccurrences.status, "expected"));
  let n = 0;
  for (const o of open) {
    const windowStart = addDays(o.expectedDate, -MATCH_WINDOW_DAYS);
    const windowEnd = addDays(o.expectedDate, MATCH_WINDOW_DAYS);
    if (windowEnd >= opts.today) continue;
    const own = monthOf(o.expectedDate);
    const before = monthOf(windowStart);
    const after = monthOf(windowEnd);
    if (!covered.has(own)) continue;
    if (before !== own && !covered.has(before) && before >= firstUpload) continue;
    if (after !== own && !covered.has(after)) continue;
    await db
      .update(schema.recurringOccurrences)
      .set({ status: "missed" })
      .where(eq(schema.recurringOccurrences.id, o.id));
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
export async function getOccurrences(
  db: Db,
  filter: OccurrenceFilter = {},
): Promise<OccurrenceView[]> {
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

  return (
    await db
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
  ).map(({ o, item, tx }) => {
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
export async function getMissedOccurrences(db: Db): Promise<OccurrenceView[]> {
  return (await getOccurrences(db, { status: "missed" })).sort(
    (a, b) => b.expectedDate.localeCompare(a.expectedDate) || a.id - b.id,
  );
}
