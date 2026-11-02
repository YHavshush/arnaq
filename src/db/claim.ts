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
  "merchant_labels",
  "user_settings",
  "ai_usage",
  "plan_overrides",
] as const;

// A user's first request creates default categories, rules and settings for them. If that happened
// before the claim, those defaults would clash with the old ones (same names), so they are replaced,
// but only while the user has nothing else of their own.
const DEFAULT_TABLES = ["categories", "categorisation_rules", "user_settings"];
const OWN_DATA_TABLES = TABLES.filter((t) => !DEFAULT_TABLES.includes(t));

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
    for (const table of OWN_DATA_TABLES) {
      const own = (await tx.execute(
        sql`select 1 from ${sql.identifier(table)} where user_id = ${userId} limit 1`,
      )) as unknown as { rows?: unknown[] } | unknown[];
      if ((Array.isArray(own) ? own.length : (own.rows?.length ?? 0)) > 0)
        throw new Error(`That user already has data (${table}); nothing was moved.`);
    }
    await tx.execute(sql`delete from user_settings where user_id = ${userId}`);
    await tx.execute(sql`delete from categorisation_rules where user_id = ${userId}`);
    await tx.execute(sql`delete from categories where user_id = ${userId}`);
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
