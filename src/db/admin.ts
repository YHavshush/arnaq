import { createDb, type Db } from "./index";

// The root database handle. It is NOT scoped to a user: queries on it without a user fail closed,
// and with a user set they see only that user's rows, but it is the thing `withUser` wraps. App code
// must not import this file (ESLint enforces it); only src/lib/auth/request.ts, scripts and tests do.

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
export function getRootDb(): Promise<Db> {
  if (!globalForDb.__kasboekDb) {
    const opening = createDb(appDatabaseLocation(), { user: null });
    // A failed open must not stay cached, or every later request would fail too.
    opening.catch(() => {
      if (globalForDb.__kasboekDb === opening) globalForDb.__kasboekDb = undefined;
    });
    globalForDb.__kasboekDb = opening;
  }
  return globalForDb.__kasboekDb;
}
