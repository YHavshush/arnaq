import { sql } from "drizzle-orm";
import type { Db } from "./index";

/** Rows that existed before accounts did belong to this owner, whom nobody can log in as. */
export const SENTINEL_OWNER = "00000000-0000-0000-0000-000000000000";

const TABLES = [
  "accounts",
  "categories",
  "categorisation_rules",
  "imports",
  "recurring_items",
  "recurring_occurrences",
  "recurring_suggestion_rejections",
  "transactions",
  "budgets",
  "monthly_total_budget",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Give the rows of the sentinel owner (everything created before accounts existed) to a real user.
 * Needs the database owner (it bypasses RLS); run it by hand with `npm run db:claim -- <user id>`.
 * One transaction: either everything moves or nothing. Returns how many rows moved per table.
 */
export async function claimSentinelRows(
  owner: Db,
  userId: string,
): Promise<Record<string, number>> {
  if (!UUID_RE.test(userId) || userId === SENTINEL_OWNER)
    throw new Error("Give the new owner's user id (a uuid).");
  return await owner.transaction(async (tx) => {
    await tx.execute(sql`set constraints all deferred`);
    await tx.execute(
      sql`insert into app_users (user_id) values (${userId}) on conflict do nothing`,
    );
    const moved: Record<string, number> = {};
    for (const table of TABLES) {
      const res = (await tx.execute(
        sql`update ${sql.identifier(table)} set user_id = ${userId} where user_id = ${SENTINEL_OWNER} returning 1`,
      )) as unknown as { rows?: unknown[] } | unknown[];
      moved[table] = Array.isArray(res) ? res.length : (res.rows?.length ?? 0);
    }
    await tx.execute(sql`delete from app_users where user_id = ${SENTINEL_OWNER}`);
    return moved;
  });
}
