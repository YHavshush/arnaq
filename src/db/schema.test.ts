import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { TEST_USER_A, createDb, one, schema } from "./index";
import { withUser } from "./scoped";

describe("database", () => {
  it("applies migrations and stores money as integer cents", async () => {
    const db = await createDb(":memory:");

    const [account] = await db
      .insert(schema.accounts)
      .values({ name: "Test", bank: "rabobank" })
      .returning();
    await db.insert(schema.transactions).values({
      accountId: account.id,
      date: "2026-10-01",
      amount: -1234,
      importHash: "hash-1",
    });

    const [row] = await db.select().from(schema.transactions);
    expect(row.amount).toBe(-1234);
    expect(Number.isInteger(row.amount)).toBe(true);
  });

  it("rejects a duplicate import_hash", async () => {
    const db = await createDb(":memory:");
    const [account] = await db
      .insert(schema.accounts)
      .values({ name: "Test", bank: "revolut" })
      .returning();
    const row = { accountId: account.id, date: "2026-10-01", amount: 100, importHash: "same" };

    await db.insert(schema.transactions).values(row);
    await expect(db.insert(schema.transactions).values(row)).rejects.toThrow();
  });

  it("has row level security on every table (Supabase exposes public over REST)", async () => {
    const db = await createDb(":memory:");
    const { rows } = (await db.execute(
      sql`select c.relname, c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
    )) as unknown as { rows: { relname: string; relrowsecurity: boolean }[] };
    const declared = (Object.values(schema).filter((t) => is(t, PgTable)) as PgTable[])
      .map((t) => getTableName(t))
      .sort();
    expect(rows.map((r) => r.relname).sort()).toEqual(declared);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("keeps data in a PGlite folder between opens", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kasboek-"));
    const location = path.join(dir, "pglite");
    try {
      const db = await createDb(location);
      await withUser(db, TEST_USER_A, (tx) =>
        tx.insert(schema.accounts).values({ name: "Blijft", bank: "revolut" }),
      );
      const again = await createDb(location);
      const names = await withUser(again, TEST_USER_A, async (tx) =>
        (await tx.select().from(schema.accounts)).map((a) => a.name),
      );
      expect(names).toEqual(["Blijft"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("one() returns the first row and throws when there is none", async () => {
    const db = await createDb(":memory:");
    expect((await one(db.select().from(schema.categories))).name).toBeTruthy();
    await expect(one(db.select().from(schema.accounts))).rejects.toThrow(/Expected a row/);
  });

  it("refuses a URL-shaped DATABASE_URL that is not postgres:// without echoing it", async () => {
    const secret = "hunter2-secret";
    const error = await createDb(`mysql://user:${secret}@host/db`).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).toMatch(/postgres:\/\//);
  });
});
