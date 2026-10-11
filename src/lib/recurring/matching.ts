import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays, dayNumber } from "./dates";
import { identityMatches } from "./normalise";
import { MATCH_WINDOW_DAYS } from "./occurrences";

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
function unlinkInternalTransfers(db: Db): number {
  const stale = db
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
    )
    .all();
  for (const s of stale) {
    db.update(schema.recurringOccurrences)
      .set({ status: "expected", transactionId: null })
      .where(eq(schema.recurringOccurrences.id, s.occurrenceId))
      .run();
    db.update(schema.transactions)
      .set({ matchedOccurrenceId: null })
      .where(eq(schema.transactions.id, s.transactionId))
      .run();
  }
  return stale.length;
}

/**
 * Link transactions to open (`expected` or `missed`) occurrences of active items.
 *
 * A transaction is a candidate for an occurrence when it is not an internal transfer, not
 * matched yet, in its account's currency, has the item's sign (expense = outgoing,
 * income = incoming), matches the item's IBAN or counterparty, its absolute amount is within
 * the item's tolerance of the occurrence's expected amount, and its date is within
 * MATCH_WINDOW_DAYS of the expected date.
 *
 * Pairs are chosen globally and greedily: all candidate pairs sorted by date distance, then
 * amount distance, then transaction id, then occurrence id; a pair is taken when neither side
 * is used yet. So matching is one-to-one and deterministic. Matches are sticky: a later,
 * better fitting transaction never steals an existing match (history is not rewritten).
 *
 * On a match the occurrence becomes `matched` (also when it was `missed`: a late payment), both
 * sides are linked, and the transaction gets the item's category if it has none yet. The
 * occurrence keeps its expectedAmount (the plan); the real amount lives on the transaction,
 * see getOccurrences(). Running it twice changes nothing the second time.
 */
export function matchOccurrences(db: Db): MatchResult {
  const unlinked = unlinkInternalTransfers(db);

  const open = db
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
    .all();
  if (open.length === 0) return { matched: 0, unlinked };

  const dates = open.map((r) => r.o.expectedDate).sort();
  const txs = db
    .select({ t: schema.transactions, accountCurrency: schema.accounts.currency })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        isNull(schema.transactions.matchedOccurrenceId),
        eq(schema.transactions.isInternalTransfer, false),
        gte(schema.transactions.date, addDays(dates[0], -MATCH_WINDOW_DAYS)),
        lte(schema.transactions.date, addDays(dates[dates.length - 1], MATCH_WINDOW_DAYS)),
      ),
    )
    .all()
    .filter(({ t, accountCurrency }) => t.currency === accountCurrency)
    .map(({ t }) => t);

  type Pair = {
    o: (typeof open)[number]["o"];
    item: (typeof open)[number]["item"];
    t: (typeof txs)[number];
    dateDiff: number;
    amountDiff: number;
  };
  const pairs: Pair[] = [];
  for (const { o, item } of open) {
    const expectedDay = dayNumber(o.expectedDate);
    for (const t of txs) {
      if (item.type === "expense" ? t.amount >= 0 : t.amount <= 0) continue;
      const dateDiff = Math.abs(dayNumber(t.date) - expectedDay);
      if (dateDiff > MATCH_WINDOW_DAYS) continue;
      const amountDiff = Math.abs(Math.abs(t.amount) - o.expectedAmount);
      if (amountDiff > item.tolerance) continue;
      if (!identityMatches(item, t)) continue;
      pairs.push({ o, item, t, dateDiff, amountDiff });
    }
  }
  pairs.sort(
    (a, b) =>
      a.dateDiff - b.dateDiff || a.amountDiff - b.amountDiff || a.t.id - b.t.id || a.o.id - b.o.id,
  );

  const usedOccurrences = new Set<number>();
  const usedTransactions = new Set<number>();
  let matched = 0;
  for (const { o, item, t } of pairs) {
    if (usedOccurrences.has(o.id) || usedTransactions.has(t.id)) continue;
    usedOccurrences.add(o.id);
    usedTransactions.add(t.id);
    db.update(schema.recurringOccurrences)
      .set({ status: "matched", transactionId: t.id })
      .where(eq(schema.recurringOccurrences.id, o.id))
      .run();
    db.update(schema.transactions)
      .set({
        matchedOccurrenceId: o.id,
        ...(t.categoryId === null && item.categoryId !== null
          ? { categoryId: item.categoryId }
          : {}),
      })
      .where(eq(schema.transactions.id, t.id))
      .run();
    matched++;
  }
  return { matched, unlinked };
}
