import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays, dayNumber } from "./dates";
import { identityMatches, type Identity } from "./normalise";
import { MATCH_WINDOW_DAYS, type RecurringType } from "./occurrences";

export interface MatchResult {
  /** Occurrences newly linked to a transaction. */
  matched: number;
  /** Matched occurrences released because their transaction became an internal transfer. */
  unlinked: number;
}

/**
 * A matched transaction that later turned out to be an internal transfer (the other side of
 * the transfer was uploaded afterwards, or the user re-categorised it) is no payment to the
 * item after all. Release the occurrence so it can match something else or become missed.
 */
async function unlinkInternalTransfers(db: Db): Promise<number> {
  const stale = await db
    .select({ occurrenceId: schema.recurringOccurrences.id, transactionId: schema.transactions.id })
    .from(schema.recurringOccurrences)
    .innerJoin(
      schema.transactions,
      eq(schema.transactions.id, schema.recurringOccurrences.transactionId),
    )
    .where(
      and(
        eq(schema.recurringOccurrences.status, "matched"),
        eq(schema.transactions.isInternalTransfer, true),
      ),
    );
  for (const s of stale) {
    await db
      .update(schema.recurringOccurrences)
      .set({ status: "expected", transactionId: null })
      .where(eq(schema.recurringOccurrences.id, s.occurrenceId));
    await db
      .update(schema.transactions)
      .set({ matchedOccurrenceId: null })
      .where(eq(schema.transactions.id, s.transactionId));
  }
  return stale.length;
}

export type MatchCandidate = typeof schema.transactions.$inferSelect;

/** An occurrence waiting for its payment, stored or (in the forecast) only planned. */
export interface OpenOccurrence {
  /** Unique per call; the last tie-breaker (the occurrence id for stored occurrences). */
  key: number;
  expectedDate: string;
  /** Positive cents. */
  expectedAmount: number;
  item: Identity & { type: RecurringType; tolerance: number };
}

/**
 * Transactions that may still pay an occurrence: not matched yet, not an internal transfer,
 * in their account's currency, dated from..to (inclusive).
 */
export async function unmatchedCandidates(
  db: Db,
  from: string,
  to: string,
): Promise<MatchCandidate[]> {
  return (
    await db
      .select({ t: schema.transactions, accountCurrency: schema.accounts.currency })
      .from(schema.transactions)
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
      .where(
        and(
          isNull(schema.transactions.matchedOccurrenceId),
          eq(schema.transactions.isInternalTransfer, false),
          gte(schema.transactions.date, from),
          lte(schema.transactions.date, to),
        ),
      )
  )
    .filter(({ t, accountCurrency }) => t.currency === accountCurrency)
    .map(({ t }) => t);
}

/**
 * Pure: choose which transaction pays which occurrence. A transaction is a candidate for an
 * occurrence when it has the item's sign (expense = outgoing, income = incoming), matches the
 * item's IBAN or counterparty, its absolute amount is within the item's tolerance of the
 * expected amount and its date is within MATCH_WINDOW_DAYS of the expected date.
 *
 * Pairs are chosen globally and greedily: all candidate pairs sorted by date distance, then
 * amount distance, then transaction id, then occurrence key; a pair is taken when neither side
 * is used yet. So the result is one-to-one and deterministic.
 */
export function pairOccurrences<O extends OpenOccurrence>(
  open: readonly O[],
  txs: readonly MatchCandidate[],
): { o: O; t: MatchCandidate }[] {
  // Transactions sorted by day, so each occurrence only looks at its +-window slice
  // (binary search) instead of every transaction. Day numbers are computed once.
  const byDay = txs
    .map((t) => ({ t, day: dayNumber(t.date) }))
    .sort((a, b) => a.day - b.day || a.t.id - b.t.id);
  const firstFrom = (day: number) => {
    let lo = 0;
    let hi = byDay.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byDay[mid].day < day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const pairs: { o: O; t: MatchCandidate; dateDiff: number; amountDiff: number }[] = [];
  for (const o of open) {
    const { item } = o;
    const expectedDay = dayNumber(o.expectedDate);
    for (let i = firstFrom(expectedDay - MATCH_WINDOW_DAYS); i < byDay.length; i++) {
      const { t, day } = byDay[i];
      if (day > expectedDay + MATCH_WINDOW_DAYS) break;
      if (item.type === "expense" ? t.amount >= 0 : t.amount <= 0) continue;
      const dateDiff = Math.abs(day - expectedDay);
      const amountDiff = Math.abs(Math.abs(t.amount) - o.expectedAmount);
      if (amountDiff > item.tolerance) continue;
      if (!identityMatches(item, t)) continue;
      pairs.push({ o, t, dateDiff, amountDiff });
    }
  }
  pairs.sort(
    (a, b) =>
      a.dateDiff - b.dateDiff ||
      a.amountDiff - b.amountDiff ||
      a.t.id - b.t.id ||
      a.o.key - b.o.key,
  );

  const usedOccurrences = new Set<number>();
  const usedTransactions = new Set<number>();
  const chosen: { o: O; t: MatchCandidate }[] = [];
  for (const { o, t } of pairs) {
    if (usedOccurrences.has(o.key) || usedTransactions.has(t.id)) continue;
    usedOccurrences.add(o.key);
    usedTransactions.add(t.id);
    chosen.push({ o, t });
  }
  return chosen;
}

/**
 * Link transactions to open (`expected` or `missed`) occurrences of active items, using
 * unmatchedCandidates and pairOccurrences (see there for the rules).
 *
 * Matches are sticky: a later, better fitting transaction never steals an existing match
 * (history is not rewritten).
 *
 * On a match the occurrence becomes `matched` (also when it was `missed`: a late payment), both
 * sides are linked, and the transaction gets the item's category if it has none yet. The
 * occurrence keeps its expectedAmount (the plan); the real amount lives on the transaction,
 * see getOccurrences(). Running it twice changes nothing the second time.
 */
export async function matchOccurrences(db: Db): Promise<MatchResult> {
  const unlinked = await unlinkInternalTransfers(db);

  const open = (
    await db
      .select({ o: schema.recurringOccurrences, item: schema.recurringItems })
      .from(schema.recurringOccurrences)
      .innerJoin(
        schema.recurringItems,
        eq(schema.recurringItems.id, schema.recurringOccurrences.recurringItemId),
      )
      .where(
        and(
          inArray(schema.recurringOccurrences.status, ["expected", "missed"]),
          eq(schema.recurringItems.active, true),
        ),
      )
  ).map(({ o, item }) => ({ ...o, key: o.id, item }));
  if (open.length === 0) return { matched: 0, unlinked };

  const dates = open.map((o) => o.expectedDate).sort();
  const txs = await unmatchedCandidates(
    db,
    addDays(dates[0], -MATCH_WINDOW_DAYS),
    addDays(dates[dates.length - 1], MATCH_WINDOW_DAYS),
  );

  let matched = 0;
  for (const { o, t } of pairOccurrences(open, txs)) {
    await db
      .update(schema.recurringOccurrences)
      .set({ status: "matched", transactionId: t.id })
      .where(eq(schema.recurringOccurrences.id, o.id));
    await db
      .update(schema.transactions)
      .set({
        matchedOccurrenceId: o.id,
        ...(t.categoryId === null && o.item.categoryId !== null
          ? { categoryId: o.item.categoryId }
          : {}),
      })
      .where(eq(schema.transactions.id, t.id));
    matched++;
  }
  return { matched, unlinked };
}
