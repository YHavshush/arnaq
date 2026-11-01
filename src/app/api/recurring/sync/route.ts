import { handle, todayIso } from "@/lib/api";
import { userDb } from "@/lib/auth/request";
import { planThroughMonth, syncRecurring } from "@/lib/recurring/sync";

/**
 * POST: bring fixed items up to date with the transactions that are in (plan, match, mark overdue). Safe to call any
 * time: nothing changes when nothing is new. Answers what it did: { occurrencesCreated, matched, unlinked, missed }.
 */
export async function POST() {
  return await handle(async () =>
    Response.json(
      await userDb(async (db) => {
        // Through this month at least: a new month has its fixed items planned before its first transaction.
        const today = todayIso();
        return syncRecurring(db, { throughMonth: await planThroughMonth(db, today), today });
      }),
    ),
  );
}
