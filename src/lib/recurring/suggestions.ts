import { and, eq, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { RECURRING_TYPES } from "@/db/schema";
import { addMonths, clampDay, daysBetween, daysInMonth, isDate, monthDiff, monthOf } from "./dates";
import { RecurringError } from "./errors";
import { createRecurringItem, type RecurringItem } from "./items";
import { identityMatches, normaliseCounterparty, normaliseIban } from "./normalise";
import type { RecurringType } from "./occurrences";

/** Need at least this many consecutive months before suggesting anything. */
export const MIN_MONTHS = 3;
/** Day-of-month spread allowed across the months (payment dates drift with weekends). */
export const MAX_DAY_SPREAD = 5;
/** Amounts must be within max(10% of the median, 2 euro) of the median. */
const AMOUNT_SPREAD_PERCENT = 10;
const AMOUNT_SPREAD_MIN_CENTS = 200;
/** More transactions than this per month on average looks like shopping, not a fixed charge. */
const MAX_TX_PER_MONTH = 1.5;
/** The last payment must be in the newest month with data or the month before. */
const MAX_MONTHS_SINCE_LAST = 1;

export interface Suggestion {
  /** Normalised counterparty; together with `type` it identifies the suggestion. */
  key: string;
  type: RecurringType;
  name: string;
  matchCounterparty: string;
  matchIban: string | null;
  expectedAmount: number; // positive cents, median of the months
  tolerance: number; // cents
  dayOfMonth: number;
  /** Only monthly series are detected (see detectSuggestions). */
  frequency: "monthly";
  categoryId: number | null;
  /** First day of the first month the series covers, so accepting matches the history. */
  startDate: string;
  /** Months the payments were for, and the transactions that support the suggestion. */
  evidence: { months: string[]; transactionIds: number[] };
}

interface Tx {
  id: number;
  date: string;
  amount: number; // absolute cents
  counterparty: string;
  counterpartyIban: string | null;
  categoryId: number | null;
}

/** Lower median: always one of the inputs, so integer cents stay integer. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * How a transaction is placed in time. "calendar": its own month and day. "month-end": a
 * payment around the turn of the month (30th, 31st, 1st, 2nd...) is booked to the month that
 * just ended, at an offset from its last day (0 = last day, -1 = the day before, 1 = the 1st
 * of the next month). Without the second view a rent paid on the last working day would look
 * wildly irregular (days 31, 28, 1, 30).
 */
type Framing = "calendar" | "month-end";

function place(t: Tx, framing: Framing): { period: string; pos: number } {
  const month = monthOf(t.date);
  const day = Number(t.date.slice(8, 10));
  if (framing === "calendar") return { period: month, pos: day };
  return day > 15
    ? { period: month, pos: day - daysInMonth(month) }
    : { period: addMonths(month, -1), pos: day };
}

interface Series {
  framing: Framing;
  months: string[];
  picks: Tx[];
  spread: number;
  dayOfMonth: number;
  expectedAmount: number;
  maxDeviation: number;
}

/** The latest run of consecutive months under one framing, if it looks like a fixed charge. */
function findSeries(txs: Tx[], framing: Framing): Series | null {
  const byPeriod = new Map<string, Tx[]>();
  for (const t of txs) {
    const { period } = place(t, framing);
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), t]);
  }
  const periods = [...byPeriod.keys()].sort();
  let first = periods.length - 1;
  while (first > 0 && monthDiff(periods[first - 1], periods[first]) === 1) first--;
  const months = periods.slice(first);
  if (months.length < MIN_MONTHS) return null;

  const inRun = months.flatMap((m) => byPeriod.get(m)!);
  if (inRun.length > months.length * MAX_TX_PER_MONTH) return null;

  // One transaction per month: the one closest to the overall median (ties: earliest).
  const overall = median(inRun.map((t) => t.amount));
  const picks = months.map(
    (m) =>
      [...byPeriod.get(m)!].sort(
        (a, b) =>
          Math.abs(a.amount - overall) - Math.abs(b.amount - overall) ||
          a.date.localeCompare(b.date) ||
          a.id - b.id,
      )[0],
  );

  const expectedAmount = median(picks.map((t) => t.amount));
  const allowed = Math.max(
    Math.round((expectedAmount * AMOUNT_SPREAD_PERCENT) / 100),
    AMOUNT_SPREAD_MIN_CENTS,
  );
  const deviations = picks.map((t) => Math.abs(t.amount - expectedAmount));
  if (deviations.some((d) => d > allowed)) return null;

  const positions = picks.map((t) => place(t, framing).pos);
  const spread = Math.max(...positions) - Math.min(...positions);
  if (spread > MAX_DAY_SPREAD) return null;

  const mid = median(positions);
  // Month-end offsets map back to a day: 0 -> 31 (clamped to the last day), -1 -> 30, 2 -> 2.
  const dayOfMonth = framing === "calendar" || mid > 0 ? mid : 31 + mid;
  return {
    framing,
    months,
    picks,
    spread,
    dayOfMonth,
    expectedAmount,
    maxDeviation: Math.max(...deviations),
  };
}

/** The month whose expected date (for this day) is nearest to a transaction date. */
function occurrenceMonthFor(date: string, dayOfMonth: number): string {
  const m = monthOf(date);
  return [addMonths(m, -1), m, addMonths(m, 1)]
    .map((c) => ({ c, d: Math.abs(daysBetween(clampDay(c, dayOfMonth), date)) }))
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))[0].c;
}

function mostCommon(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

function assertToday(today: string): void {
  if (!isDate(today)) throw new RecurringError(`Ongeldige datum "${today}". Gebruik JJJJ-MM-DD.`);
}

/**
 * Suggest monthly vaste lasten and inkomen from transaction history up to `today`.
 *
 * Transactions (not internal transfers, not already matched to a recurring item, in the
 * account currency) are grouped by normalised counterparty and sign. A group is suggested when
 * its latest run of consecutive months is at least MIN_MONTHS long, has at most ~1 transaction
 * a month, the per-month amounts are within max(10%, 2 euro) of their median, the day of month
 * varies by at most MAX_DAY_SPREAD (month-end wrap aware), the last payment is in the newest
 * month with data or the month before (so ended subscriptions drop off), it is not covered by
 * an active recurring item, and it was not rejected before.
 *
 * Only monthly series are detected. Quarterly and yearly charges need years of history to be
 * told apart from noise reliably, so for now those are created by hand.
 */
export async function detectSuggestions(db: Db, opts: { today: string }): Promise<Suggestion[]> {
  assertToday(opts.today);
  const rows = (
    await db
      .select({ t: schema.transactions, accountCurrency: schema.accounts.currency })
      .from(schema.transactions)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
      .where(
        and(
          eq(schema.transactions.isInternalTransfer, false),
          lte(schema.transactions.date, opts.today),
        ),
      )
  )
    .filter(({ t, accountCurrency }) => t.currency === accountCurrency && t.amount !== 0)
    .map(({ t }) => t);
  if (rows.length === 0) return [];
  const newestMonth = monthOf(rows.reduce((a, t) => (t.date > a ? t.date : a), rows[0].date));

  const groups = new Map<string, { key: string; type: RecurringType; txs: Tx[] }>();
  for (const t of rows) {
    if (t.matchedOccurrenceId !== null) continue;
    const key = normaliseCounterparty(t.counterparty);
    if (!key) continue;
    const type: RecurringType = t.amount < 0 ? "expense" : "income";
    const id = `${type}|${key}`;
    const group = groups.get(id) ?? { key, type, txs: [] };
    group.txs.push({
      id: t.id,
      date: t.date,
      amount: Math.abs(t.amount),
      counterparty: t.counterparty!.trim(),
      counterpartyIban: normaliseIban(t.counterpartyIban) || null,
      categoryId: t.categoryId,
    });
    groups.set(id, group);
  }

  const rejected = new Set(
    (await db.select().from(schema.recurringSuggestionRejections)).map((r) => `${r.type}|${r.key}`),
  );
  const activeItems = await db
    .select()
    .from(schema.recurringItems)
    .where(eq(schema.recurringItems.active, true));
  const categoryType = new Map(
    (await db.select().from(schema.categories)).map((c) => [c.id, c.type]),
  );

  const out: Suggestion[] = [];
  for (const [id, { key, type, txs }] of groups) {
    if (rejected.has(id)) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const candidates = (["calendar", "month-end"] as const)
      .map((f) => findSeries(txs, f))
      .filter((s): s is Series => s !== null)
      .sort((a, b) => a.spread - b.spread || b.months.length - a.months.length);
    const series = candidates[0];
    if (!series) continue;

    const latest = series.picks[series.picks.length - 1];
    if (monthDiff(monthOf(latest.date), newestMonth) > MAX_MONTHS_SINCE_LAST) continue;
    const covered = activeItems.some(
      (item) =>
        item.type === type &&
        identityMatches(item, {
          counterparty: latest.counterparty,
          counterpartyIban: latest.counterpartyIban,
        }),
    );
    if (covered) continue;

    const ibans = new Set(series.picks.map((t) => t.counterpartyIban));
    const [onlyIban] = ibans;
    const categoryId = mostCommon(
      series.picks
        .map((t) => t.categoryId)
        .filter((c): c is number => c !== null && categoryType.get(c) === type),
    );
    // The month each payment was for (a premium paid on 30 June can be July's).
    const forMonths = [
      ...new Set(series.picks.map((t) => occurrenceMonthFor(t.date, series.dayOfMonth))),
    ].sort();

    out.push({
      key,
      type,
      name: latest.counterparty,
      matchCounterparty: latest.counterparty,
      matchIban: ibans.size === 1 ? onlyIban : null,
      expectedAmount: series.expectedAmount,
      // At least the spread seen, 5% of the amount, and one euro, so small drifts still match.
      tolerance: Math.max(series.maxDeviation, Math.round(series.expectedAmount / 20), 100),
      dayOfMonth: series.dayOfMonth,
      frequency: "monthly",
      categoryId,
      startDate: `${forMonths[0]}-01`,
      evidence: {
        months: forMonths,
        transactionIds: series.picks.map((t) => t.id),
      },
    });
  }
  return out.sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
}

export interface SuggestionRef {
  key: string;
  type: RecurringType;
}

function assertRef(ref: SuggestionRef): SuggestionRef {
  const key = normaliseCounterparty(ref.key);
  if (!key) throw new RecurringError("De suggestie is onvolledig.");
  if (!RECURRING_TYPES.includes(ref.type)) throw new RecurringError("Kies uitgave of inkomen.");
  return { key, type: ref.type };
}

/** What the user may change when accepting a suggestion. */
export type SuggestionOverrides = Partial<
  Pick<Suggestion, "name" | "expectedAmount" | "tolerance" | "dayOfMonth" | "categoryId">
>;

/**
 * Turn a suggestion into a recurring item that starts at the first month seen, generate its
 * occurrences through this month and match the history, so those payments count as recurring
 * from then on. Accepting again returns the existing item instead of creating a duplicate.
 */
export async function acceptSuggestion(
  db: Db,
  ref: SuggestionRef & SuggestionOverrides,
  opts: { today: string },
): Promise<{ item: RecurringItem; created: boolean }> {
  assertToday(opts.today);
  const { key, type } = assertRef(ref);
  return await db.transaction(async (tx) => {
    const s = (await detectSuggestions(tx, opts)).find((x) => x.key === key && x.type === type);
    if (!s) {
      const existing = (
        await tx
          .select()
          .from(schema.recurringItems)
          .where(and(eq(schema.recurringItems.type, type), eq(schema.recurringItems.active, true)))
      ).find((i) => normaliseCounterparty(i.matchCounterparty) === key);
      if (existing) return { item: existing, created: false };
      throw new RecurringError("Deze suggestie bestaat niet (meer).");
    }
    const item = await createRecurringItem(
      tx,
      {
        name: ref.name ?? s.name,
        type: s.type,
        matchCounterparty: s.matchCounterparty,
        matchIban: s.matchIban,
        expectedAmount: ref.expectedAmount ?? s.expectedAmount,
        tolerance: ref.tolerance ?? s.tolerance,
        dayOfMonth: ref.dayOfMonth ?? s.dayOfMonth,
        frequency: s.frequency,
        categoryId: ref.categoryId !== undefined ? ref.categoryId : s.categoryId,
        startDate: s.startDate,
      },
      opts,
    );
    return { item, created: true };
  });
}

/** Never suggest this counterparty (with this sign) again. Safe to call twice. */
export async function rejectSuggestion(db: Db, ref: SuggestionRef): Promise<void> {
  const { key, type } = assertRef(ref);
  await db
    .insert(schema.recurringSuggestionRejections)
    .values({ key, type })
    .onConflictDoNothing({
      target: [schema.recurringSuggestionRejections.key, schema.recurringSuggestionRejections.type],
    });
}
