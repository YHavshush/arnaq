import { max } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { maxString, monthOf } from "./dates";
import { matchOccurrences } from "./matching";
import { generateOccurrences, markMissed } from "./occurrences";

/** Month of the newest transaction, or null when there are none. */
export async function latestTransactionMonth(db: Db): Promise<string | null> {
  const [row] = await db.select({ date: max(schema.transactions.date) }).from(schema.transactions);
  return row?.date ? monthOf(row.date) : null;
}

/** Through which month to plan after a user edit: this month, or later if data goes further. */
export async function planThroughMonth(db: Db, today: string): Promise<string> {
  const latest = await latestTransactionMonth(db);
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
export async function syncRecurring(
  db: Db,
  opts: { throughMonth: string | null; today?: string },
): Promise<SyncResult> {
  const occurrencesCreated = opts.throughMonth
    ? await generateOccurrences(db, { throughMonth: opts.throughMonth })
    : 0;
  const { matched, unlinked } = await matchOccurrences(db);
  const missed = opts.today ? await markMissed(db, { today: opts.today }) : 0;
  return { occurrencesCreated, matched, unlinked, missed };
}
