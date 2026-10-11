import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/** Open a SQLite database (":memory:" for tests) and apply pending migrations. */
export function createDb(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

let instance: Db | undefined;

/** Shared app database. Lives in ./data (git-ignored) unless DATABASE_URL is set. */
export function getDb(): Db {
  instance ??= createDb(process.env.DATABASE_URL ?? "./data/budget.db");
  return instance;
}

export { schema };
