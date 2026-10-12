import { sql } from "drizzle-orm";
import { seedDefaults } from "@/lib/categories/seed";
import type { Db } from "./index";
import { schema } from "./index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Users whose defaults are known to exist in a database, so only a user's first request pays for the
// check. Added to after the transaction commits, never before: a rollback must not stick. Keyed by
// the database handle, so a fresh test database starts empty.
const seededByRoot = new WeakMap<object, Set<string>>();

/**
 * Run `fn` as one user, in one transaction. This is how every request touches the database:
 * the user's id is set for the transaction only (`set_config(..., true)`), so it cannot leak to
 * another request on a pooled connection, and the row level policies show `fn` that user's rows
 * and nobody else's. Nested `db.transaction` calls inside `fn` become savepoints and inherit it.
 * On a user's first request their default categories and rules are created.
 */
export async function withUser<T>(
  root: Db,
  userId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("Not a valid user id.");
  const seeded = seededByRoot.get(root) ?? new Set<string>();
  seededByRoot.set(root, seeded);
  const result = await root.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    if (!seeded.has(userId)) {
      const created = await tx
        .insert(schema.appUsers)
        .values({ userId })
        .onConflictDoNothing()
        .returning({ id: schema.appUsers.userId });
      if (created.length > 0) await seedDefaults(tx);
    }
    return await fn(tx);
  });
  seeded.add(userId);
  return result;
}
