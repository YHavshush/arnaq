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

/**
 * Open a database.
 * - ":memory:": throwaway PGlite (tests).
 * - a directory path: PGlite stored there (local development, no server needed).
 * - a postgres:// URL: a real Postgres, e.g. Supabase.
 * PGlite is migrated and seeded on open. A real Postgres is only touched by `npm run db:migrate`
 * (pass `migrate: true`), so the running app never changes a hosted schema by itself.
 */
export async function createDb(location: string, opts: { migrate?: boolean } = {}): Promise<Db> {
  if (isPostgresUrl(location)) {
    // prepare: false keeps this working through Supabase's transaction pooler (port 6543).
    const db = drizzlePostgres(postgres(location, { prepare: false, ssl: sslFor(location) }), {
      schema,
    });
    if (opts.migrate) {
      await migratePostgres(db, { migrationsFolder: migrationsFolder() });
      await seedDefaults(db);
    }
    return db;
  }
  if (location === ":memory:" && opts.migrate !== false) {
    // Booting + migrating PGlite takes ~1s; cloning a migrated, seeded snapshot takes ~0.1s.
    templateDump ??= buildTemplateDump().catch((e) => {
      templateDump = undefined; // do not cache a failure
      throw e;
    });
    return drizzlePglite(new PGlite({ loadDataDir: await templateDump }), { schema });
  }
  // Anything URL-shaped that is not postgres:// is a typo: do not turn it into a folder name
  // (it would contain the password). The message never repeats the value.
  if (location.includes("://")) throw new Error("DATABASE_URL must be a postgres:// URL.");
  if (location !== ":memory:") mkdirSync(path.dirname(location), { recursive: true });
  const db = drizzlePglite(location === ":memory:" ? new PGlite() : new PGlite(location), {
    schema,
  });
  if (opts.migrate !== false) {
    await migratePglite(db, { migrationsFolder: migrationsFolder() });
    await seedDefaults(db);
  }
  return db;
}

let templateDump: Promise<Blob | File> | undefined;

async function buildTemplateDump(): Promise<Blob | File> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: migrationsFolder() });
  await seedDefaults(db);
  const dump = await client.dumpDataDir("none");
  await client.close();
  return dump;
}

// Cached on globalThis so Next's dev reloads do not open the same PGlite folder twice.
const globalForDb = globalThis as unknown as { __kasboekDb?: Promise<Db> };

/** Where the app's database lives: DATABASE_URL, or PGlite in ./data/pglite for local use. */
function appDatabaseLocation(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  // A forgotten variable on the server must not quietly start an empty, throwaway database.
  if (process.env.NODE_ENV === "production" && process.env.KASBOEK_ALLOW_LOCAL_DB !== "1")
    throw new Error("DATABASE_URL is not set. Production needs a postgres:// connection string.");
  return "./data/pglite";
}

/** Shared app database: PGlite in ./data/pglite unless DATABASE_URL is set. */
export function getDb(): Promise<Db> {
  if (!globalForDb.__kasboekDb) {
    const opening = createDb(appDatabaseLocation());
    // A failed open must not stay cached, or every later request would fail too.
    opening.catch(() => {
      if (globalForDb.__kasboekDb === opening) globalForDb.__kasboekDb = undefined;
    });
    globalForDb.__kasboekDb = opening;
  }
  return globalForDb.__kasboekDb;
}

export { schema };
