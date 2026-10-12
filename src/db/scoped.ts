import { sql } from "drizzle-orm";
import { seedDefaults } from "@/lib/categories/seed";
import type { Db } from "./index";
import { schema } from "./index";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Users whose defaults are known to exist in a database, so only a user's first request pays for the
// check. Added to after the transaction commits, never before: a rollback must not stick. Keyed by
// the database handle, so a fresh test database starts empty.
const seededByRoot = new WeakMap<object, Set<string>>();

// Roots whose connection role was checked. A promise, so concurrent first requests share one check;
// a failed check is forgotten so the next request tries again (and fails again, loudly).
const roleChecked = new WeakMap<object, Promise<void>>();

/**
 * Tenancy is enforced by the database alone (no query filters on user_id), so it only holds when the
 * connection is a role the row level policies apply to. A connection string for the owner
 * (`postgres`) or any superuser/BYPASSRLS role would silently show every user everyone's rows.
 * Refuse to serve anything over such a connection.
 */
export async function assertTenantRole(root: Db): Promise<void> {
  let checking = roleChecked.get(root);
  if (!checking) {
    checking = (async () => {
      const result = (await root.execute(sql`
        select current_user::text as role,
               (r.rolsuper or r.rolbypassrls) as privileged,
               coalesce(pg_has_role(current_user, c.relowner, 'USAGE'), true) as owns,
               c.relrowsecurity as rls
          from pg_roles r
          left join pg_class c on c.relname = 'transactions' and c.relnamespace = 'public'::regnamespace
         where r.rolname = current_user`)) as unknown as {
        rows: { privileged: boolean; owns: boolean; rls: boolean | null }[];
      };
      const row = result.rows[0];
      if (!row || row.privileged || row.owns || !row.rls)
        throw new Error(
          "The database connection is not the restricted tenant role (kasboek_app), so row level security would not apply. Refusing to serve requests. See docs/auth-setup.md.",
        );
    })();
    roleChecked.set(root, checking);
    checking.catch(() => {
      if (roleChecked.get(root) === checking) roleChecked.delete(root);
    });
  }
  await checking;
}

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
  await assertTenantRole(root);
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
