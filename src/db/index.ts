import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { seedDefaults } from "@/lib/categories/seed";
import * as schema from "./schema";

/** Either database, or a transaction on one. All app code takes this. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = () => path.join(process.cwd(), "drizzle");
const isPostgresUrl = (s: string) => /^postgres(ql)?:\/\//i.test(s);

/** Hosted databases must use TLS; only a local server may go without. */
function sslFor(url: string): "require" | undefined {
  try {
    const u = new URL(url);
    if (u.searchParams.has("sslmode") || u.searchParams.has("ssl")) return undefined;
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? undefined : "require";
  } catch {
    return "require";
  }
}

/** First row of a query, or undefined. Replaces SQLite's `.get()`. */
export async function first<T>(query: PromiseLike<T[]>): Promise<T | undefined> {
  return (await query)[0];
}

/** First row of a query; throws when there is none. For tests and places where a row must exist. */
export async function one<T>(query: PromiseLike<T[]>): Promise<T> {
  const row = (await query)[0];
  if (row === undefined) throw new Error("Expected a row, got none.");
  return row;
}

/** Users that exist only in tests and local development. */
export const TEST_USER_A = "00000000-0000-0000-0000-00000000000a";
export const TEST_USER_B = "00000000-0000-0000-0000-00000000000b";

export interface CreateOptions {
  /** Apply pending migrations (and for PGlite, always as the owner before switching role). */
  migrate?: boolean;
  /**
   * PGlite only. The user whose rows this handle sees by default (a session-level setting, so tests
   * can call library code directly). `null`: no user, queries fail closed. Default: TEST_USER_A for
   * ":memory:", none for a stored database (its requests use withUser).
   */
  user?: string | null;
}

/** The role the app runs as: not the owner, no BYPASSRLS, so the row level policies apply to it. */
const APP_ROLE = "kasboek_app";

/**
 * Open a database.
 * - ":memory:": throwaway PGlite (tests).
 * - a directory path: PGlite stored there (local development, no server needed).
 * - a postgres:// URL: a real Postgres, e.g. Supabase.
 * PGlite is migrated on open as the owner and then switched to the app role, so tests and local
 * development run under the same row level policies as production. A real Postgres is only touched
 * by `npm run db:migrate` (pass `migrate: true`, as the owner), so the running app never changes a
 * hosted schema by itself. Default categories and rules are created per user (see withUser).
 */
export async function createDb(location: string, opts: CreateOptions = {}): Promise<Db> {
  if (isPostgresUrl(location)) {
    // prepare: false keeps this working through Supabase's transaction pooler (port 6543).
    const db = drizzlePostgres(postgres(location, { prepare: false, ssl: sslFor(location) }), {
      schema,
    });
    if (opts.migrate) await migratePostgres(db, { migrationsFolder: migrationsFolder() });
    return db;
  }

  const memory = location === ":memory:";
  let client: PGlite;
  if (memory && opts.migrate !== false) {
    // Booting + migrating PGlite takes ~1s; cloning a migrated snapshot takes ~0.1s.
    templateDump ??= buildTemplateDump().catch((e) => {
      templateDump = undefined; // do not cache a failure
      throw e;
    });
    client = new PGlite({ loadDataDir: await templateDump });
  } else {
    // Anything URL-shaped that is not postgres:// is a typo: do not turn it into a folder name
    // (it would contain the password). The message never repeats the value.
    if (location.includes("://")) throw new Error("DATABASE_URL must be a postgres:// URL.");
    if (!memory) mkdirSync(path.dirname(location), { recursive: true });
    client = memory ? new PGlite() : new PGlite(location);
    if (opts.migrate !== false)
      await migratePglite(drizzlePglite(client, { schema }), {
        migrationsFolder: migrationsFolder(),
      });
  }

  await client.exec(`SET ROLE ${APP_ROLE}`);
  const user = opts.user === undefined ? (memory ? TEST_USER_A : null) : opts.user;
  if (user) await client.query("select set_config('app.user_id', $1, false)", [user]);
  return drizzlePglite(client, { schema });
}

let templateDump: Promise<Blob | File> | undefined;

/** A migrated database with the default categories and rules of TEST_USER_A, as the owner. */
async function buildTemplateDump(): Promise<Blob | File> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: migrationsFolder() });
  await client.query("insert into app_users (user_id) values ($1)", [TEST_USER_A]);
  await client.query("select set_config('app.user_id', $1, false)", [TEST_USER_A]);
  await seedDefaults(db);
  await client.query("reset app.user_id");
  const dump = await client.dumpDataDir("none");
  await client.close();
  return dump;
}

export { schema };
