import { max } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { maxString, monthOf } from "./dates";
import { matchOccurrences } from "./matching";
import { generateOccurrences, markMissed } from "./occurrences";

/** Month of the newest transaction, or null when there are none. */
export function latestTransactionMonth(db: Db): string | null {
  const [row] = db
    .select({ date: max(schema.transactions.date) })
    .from(schema.transactions)
    .all();
  return row?.date ? monthOf(row.date) : null;
}

/** Through which month to plan after a user edit: this month, or later if data goes further. */
export function planThroughMonth(db: Db, today: string): string {
  const latest = latestTransactionMonth(db);
  return latest ? maxString(monthOf(today), latest) : monthOf(today);
}

export interface SyncResult {
  occurrencesCreated: number;
  matched: number;
  unlinked: number;
  missed: number;
}

/**
 * Bring recurring state up to date: generate occurrences through `throughMonth` (skipped when
 * null), match transactions, and, only when `today` is known, mark overdue occurrences missed.
 * Every step is idempotent, so calling this again without new data changes nothing.
 */
export function syncRecurring(
  db: Db,
  opts: { throughMonth: string | null; today?: string },
): SyncResult {
  const occurrencesCreated = opts.throughMonth
    ? generateOccurrences(db, { throughMonth: opts.throughMonth })
    : 0;
  const { matched, unlinked } = matchOccurrences(db);
  const missed = opts.today ? markMissed(db, { today: opts.today }) : 0;
  return { occurrencesCreated, matched, unlinked, missed };
}
