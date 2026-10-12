import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SENTINEL_OWNER, claimSentinelRows } from "./claim";
import { TEST_USER_B, createDb, schema } from "./index";
import { withUser } from "./scoped";

describe("claiming the rows that existed before accounts did", () => {
  it("moves everything to the new owner in one go, composite keys included", async () => {
    const db = await createDb(":memory:", { user: null });
    // Create data as the owner for the sentinel (what migration 0003 leaves behind).
    await db.execute(sql`reset role`);
    await db.execute(sql`select set_config('app.user_id', ${SENTINEL_OWNER}, false)`);
    await db.execute(
      sql`insert into app_users (user_id) values (${SENTINEL_OWNER}) on conflict do nothing`,
    );
    const [cat] = await db
      .insert(schema.categories)
      .values({ name: "Oud", type: "expense" })
      .returning();
    const [acct] = await db
      .insert(schema.accounts)
      .values({ name: "Oud", bank: "rabobank" })
      .returning();
    await db.insert(schema.transactions).values({
      accountId: acct.id,
      categoryId: cat.id,
      date: "2026-09-01",
      amount: -5,
      importHash: "old",
    });
    await db.insert(schema.budgets).values({ categoryId: cat.id, month: "2026-09", amount: 100 });

    const moved = await claimSentinelRows(db, TEST_USER_B);
    expect(moved).toMatchObject({ accounts: 1, categories: 1, transactions: 1, budgets: 1 });

    await db.execute(sql`set role kasboek_app`);
    const seen = await withUser(db, TEST_USER_B, async (tx) => ({
      tx: (await tx.select().from(schema.transactions)).length,
      acct: (await tx.select().from(schema.accounts)).map((a) => a.name),
    }));
    expect(seen).toEqual({ tx: 1, acct: ["Oud"] });
  });

  it("replaces the defaults a first login already created, and refuses a user who has real data", async () => {
    const db = await createDb(":memory:", { user: null });
    // The user logged in first: their defaults exist (same names as the old ones).
    await withUser(db, TEST_USER_B, async () => undefined);
    await db.execute(sql`reset role`);
    await db.execute(sql`select set_config('app.user_id', ${SENTINEL_OWNER}, false)`);
    await db.execute(
      sql`insert into app_users (user_id) values (${SENTINEL_OWNER}) on conflict do nothing`,
    );
    await db.insert(schema.categories).values({ name: "Boodschappen", type: "expense" });

    const moved = await claimSentinelRows(db, TEST_USER_B);
    expect(moved.categories).toBe(1);

    await db.execute(sql`set role kasboek_app`);
    const names = await withUser(db, TEST_USER_B, async (tx) =>
      (await tx.select().from(schema.categories)).map((c) => c.name),
    );
    expect(names).toEqual(["Boodschappen"]);

    // Now the user has own data: a second claim must not touch it.
    await withUser(db, TEST_USER_B, async (tx) => {
      await tx.insert(schema.accounts).values({ name: "Mijn", bank: "rabobank" });
    });
    await db.execute(sql`reset role`);
    await expect(claimSentinelRows(db, TEST_USER_B)).rejects.toThrow(/already has data/);
  });

  it("refuses the sentinel itself and anything that is not a uuid", async () => {
    const db = await createDb(":memory:", { user: null });
    await expect(claimSentinelRows(db, SENTINEL_OWNER)).rejects.toThrow(/uuid/);
    await expect(claimSentinelRows(db, "nope")).rejects.toThrow(/uuid/);
  });
});
