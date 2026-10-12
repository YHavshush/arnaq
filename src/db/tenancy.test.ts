import { sql, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { TEST_USER_A, TEST_USER_B, createDb, schema } from "./index";
import { assertTenantRole, withUser } from "./scoped";

const rowsOf = async (db: Awaited<ReturnType<typeof createDb>>, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: Record<string, unknown>[] }).rows;

/** The code of the Postgres error behind a failed Drizzle query. */
async function failure(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    for (
      let err: unknown = e;
      err && typeof err === "object";
      err = (err as { cause?: unknown }).cause
    ) {
      const code = (err as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    return "error";
  }
  return "no error";
}

describe("the database enforces who owns a row", () => {
  it("every table has RLS, an owner column and a tenant policy; the app role cannot bypass RLS", async () => {
    const db = await createDb(":memory:");
    const declared = (Object.values(schema).filter((t) => is(t, PgTable)) as PgTable[])
      .map((t) => getTableName(t))
      .sort();
    const policies = await rowsOf(
      db,
      sql`select tablename from pg_policies where schemaname = 'public' and policyname = 'tenant'`,
    );
    expect(policies.map((r) => r.tablename).sort()).toEqual(declared);
    const owners = await rowsOf(
      db,
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`,
    );
    expect(owners.map((r) => r.table_name).sort()).toEqual(declared);
    const [role] = await rowsOf(
      db,
      sql`select current_user as who, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user`,
    );
    expect(role).toEqual({ who: "kasboek_app", rolsuper: false, rolbypassrls: false });
  });

  it("without a user every query fails closed (no tenant)", async () => {
    const db = await createDb(":memory:", { user: null });
    expect(await failure(db.select().from(schema.accounts))).toBe("42501");
    expect(await failure(db.insert(schema.accounts).values({ name: "x", bank: "revolut" }))).toBe(
      "42501",
    );
  });

  it("a user sees only their own rows and may reuse another user's names", async () => {
    const db = await createDb(":memory:", { user: null });
    await withUser(db, TEST_USER_A, (tx) =>
      tx
        .insert(schema.accounts)
        .values({ name: "A's account", bank: "rabobank", iban: "NL00RABO0000000001" }),
    );
    const seenByB = await withUser(db, TEST_USER_B, async (tx) => ({
      accounts: await tx.select().from(schema.accounts),
      categories: (await tx.select().from(schema.categories)).length,
    }));
    expect(seenByB.accounts).toEqual([]);
    expect(seenByB.categories).toBeGreaterThan(10); // B got their own defaults on first use
    // B can have the same IBAN and the same category names as A.
    await withUser(db, TEST_USER_B, (tx) =>
      tx
        .insert(schema.accounts)
        .values({ name: "B's account", bank: "rabobank", iban: "NL00RABO0000000001" }),
    );
    const aNames = await withUser(db, TEST_USER_A, async (tx) =>
      (await tx.select().from(schema.accounts)).map((a) => a.name),
    );
    expect(aNames).toEqual(["A's account"]);
  });

  it("a user cannot write rows for someone else, nor point at someone else's rows", async () => {
    const db = await createDb(":memory:", { user: null });
    const catA = await withUser(
      db,
      TEST_USER_A,
      async (tx) => (await tx.select().from(schema.categories))[0],
    );
    await withUser(db, TEST_USER_B, async (tx) => {
      const [acct] = await tx
        .insert(schema.accounts)
        .values({ name: "B", bank: "revolut" })
        .returning();
      // Spoofing the owner is refused by the policy.
      expect(
        await failure(
          tx.transaction((t) =>
            t.insert(schema.accounts).values({ userId: TEST_USER_A, name: "x", bank: "revolut" }),
          ),
        ),
      ).toBe("42501");
      // A's category id does not exist for B: the composite foreign key refuses it.
      expect(
        await failure(
          tx.transaction((t) =>
            t.insert(schema.transactions).values({
              accountId: acct.id,
              categoryId: catA.id,
              date: "2026-09-01",
              amount: 1,
              importHash: "h",
            }),
          ),
        ),
      ).toBe("23503");
    });
  });

  it("the user setting does not outlive its transaction", async () => {
    const db = await createDb(":memory:", { user: null });
    await withUser(db, TEST_USER_A, async () => undefined);
    const [row] = await rowsOf(db, sql`select current_setting('app.user_id', true) as v`);
    expect(row.v ?? "").toBe("");
    expect(await failure(db.select().from(schema.accounts))).toBe("42501");
  });

  it("a rolled-back first request does not leave the user marked as seeded", async () => {
    const db = await createDb(":memory:", { user: null });
    await expect(
      withUser(db, TEST_USER_B, async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    const categories = await withUser(
      db,
      TEST_USER_B,
      async (tx) => (await tx.select().from(schema.categories)).length,
    );
    expect(categories).toBeGreaterThan(10);
  });

  it("refuses an id that is not a uuid", async () => {
    const db = await createDb(":memory:", { user: null });
    await expect(withUser(db, "1; drop table accounts", async () => 1)).rejects.toThrow(
      /valid user id/,
    );
  });
});

describe("the app refuses a connection that row level security does not apply to", () => {
  it("accepts the tenant role", async () => {
    const db = await createDb(":memory:");
    await expect(assertTenantRole(db)).resolves.toBeUndefined();
  });

  it("rejects the owner role, and withUser does not serve over it", async () => {
    const owner = await createDb(":memory:", { user: null });
    await owner.execute(sql`reset role`); // back to the connection's own (superuser) role
    await expect(assertTenantRole(owner)).rejects.toThrow(/restricted tenant role/);
    await expect(withUser(owner, TEST_USER_A, async () => 1)).rejects.toThrow(
      /restricted tenant role/,
    );
  });
});
