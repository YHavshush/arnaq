import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TEST_USER_B, createDb, schema } from "@/db";
import { withUser } from "@/db/scoped";
import { getBtwClients, replaceBtwClients } from "./btw/clients";
import { buildExport } from "./export";
import { RestoreError, restoreFromBackup } from "./restore";

const A = "11111111-1111-1111-1111-111111111111";

async function seeded() {
  const db = await createDb(":memory:", { user: null });
  await withUser(db, A, async (tx) => {
    const [acct] = await tx
      .insert(schema.accounts)
      .values({ name: "Rabo", bank: "rabobank", iban: "NL00RABO0000000001" })
      .returning();
    const [food] = await tx
      .insert(schema.categories)
      .values({ name: "Mijn eten", type: "expense", slug: null })
      .returning();
    await tx
      .insert(schema.categorisationRules)
      .values({ pattern: "spar", categoryId: food.id, priority: 7 });
    const [imp] = await tx
      .insert(schema.imports)
      .values({ accountId: acct.id, month: "2026-09", filename: "r.csv", rowsImported: 2 })
      .returning();
    const [item] = await tx
      .insert(schema.recurringItems)
      .values({
        name: "Huur",
        type: "expense",
        expectedAmount: 65000,
        dayOfMonth: 1,
        startDate: "2026-01-01",
        categoryId: food.id,
      })
      .returning();
    const [occ] = await tx
      .insert(schema.recurringOccurrences)
      .values({
        recurringItemId: item.id,
        month: "2026-09",
        expectedDate: "2026-09-01",
        expectedAmount: 65000,
        status: "matched",
      })
      .returning();
    const [rent] = await tx
      .insert(schema.transactions)
      .values({
        accountId: acct.id,
        importId: imp.id,
        date: "2026-09-01",
        amount: -65000,
        importHash: "h1",
        categoryId: food.id,
        categorySource: "user",
        matchedOccurrenceId: occ.id,
        counterparty: "Verhuurder",
        balanceAfter: 123400,
      })
      .returning();
    await tx.insert(schema.transactions).values({
      accountId: acct.id,
      importId: imp.id,
      date: "2026-09-03",
      amount: -450,
      importHash: "h2",
    });
    await tx
      .update(schema.recurringOccurrences)
      .set({ transactionId: rent.id })
      .where(eq(schema.recurringOccurrences.id, occ.id));
    await tx
      .insert(schema.budgets)
      .values({ categoryId: food.id, month: "2026-09", amount: 12345 });
    await tx.insert(schema.monthlyTotalBudget).values({ month: "2026-09", amount: 99999 });
    await tx.insert(schema.planOverrides).values([
      { categoryId: food.id, month: "2026-12", amount: 25000 },
      { itemId: item.id, month: "2027-03", amount: 70000 },
    ]);
    await tx
      .insert(schema.merchantLabels)
      .values({ merchantKey: "spar", categoryId: food.id, source: "user" });
    await tx.insert(schema.merchantLabels).values({ merchantKey: "guess", source: "model" });
    await tx.insert(schema.userSettings).values({
      savingsGoal: 500000,
      savingsStart: 120000,
      savingsAnchor: 20085,
      savingsAnchorDate: "2026-10-29",
      btwPaymentLag: 1,
      btwPotInSavings: true,
    });
    await replaceBtwClients(tx, [
      { name: "Featurn", paymentLag: 1, vatPercent: 21 },
      { name: "Globex GmbH", paymentLag: 2, vatPercent: 0 },
    ]);
  });
  const backup = JSON.parse(JSON.stringify(await withUser(db, A, (tx) => buildExport(tx))));
  return { db, backup };
}

describe("restoreFromBackup", () => {
  it("brings back everything for another person, with all links, and nothing of theirs is mixed with the original", async () => {
    const { db, backup } = await seeded();
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
    const got = await withUser(db, TEST_USER_B, async (tx) => ({
      tx: await tx.select().from(schema.transactions),
      occ: await tx.select().from(schema.recurringOccurrences),
      cats: await tx.select().from(schema.categories),
      budgets: await tx.select().from(schema.budgets),
      totals: await tx.select().from(schema.monthlyTotalBudget),
      labels: await tx.select().from(schema.merchantLabels),
      rules: await tx.select().from(schema.categorisationRules),
      items: await tx.select().from(schema.recurringItems),
      accounts: await tx.select().from(schema.accounts),
      plan: await tx.select().from(schema.planOverrides),
    }));
    expect(got.tx.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-65000, -450]);
    const rent = got.tx.find((t) => t.amount === -65000)!;
    const food = got.cats.find((c) => c.name === "Mijn eten")!;
    expect(rent).toMatchObject({
      categoryId: food.id,
      categorySource: "user",
      counterparty: "Verhuurder",
      balanceAfter: 123400,
    });
    // The payment and the fixed cost point at each other, and at B's own rows.
    expect(got.occ[0]).toMatchObject({ transactionId: rent.id, status: "matched" });
    expect(rent.matchedOccurrenceId).toBe(got.occ[0].id);
    expect(got.items[0].categoryId).toBe(food.id);
    expect(got.rules.find((r) => r.pattern === "spar")).toMatchObject({
      priority: 7,
      categoryId: food.id,
    });
    expect(got.rules.length).toBe(backup.tables.categorisationRules.length); // the starter rules too
    expect(got.budgets).toMatchObject([{ categoryId: food.id, amount: 12345 }]);
    expect(got.totals).toMatchObject([{ month: "2026-09", amount: 99999 }]);
    expect(got.labels.map((l) => l.merchantKey)).toEqual(["spar"]); // a model's guess is not restored
    expect(got.accounts).toHaveLength(1);
    // What was typed in the plan grid comes back, pointing at B's own category and fixed item.
    expect(
      got.plan
        .map(({ categoryId, itemId, month, amount }) => ({ categoryId, itemId, month, amount }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    ).toEqual([
      { categoryId: food.id, itemId: null, month: "2026-12", amount: 25000 },
      { categoryId: null, itemId: got.items[0].id, month: "2027-03", amount: 70000 },
    ]);
    expect(got.cats).toHaveLength(backup.tables.categories.length); // exactly the backup's categories, no extra defaults
    expect(got.cats.find((c) => c.name === "Huur")?.slug).toBe("rent");
    // The original owner is untouched.
    const original = await withUser(
      db,
      A,
      async (tx) => (await tx.select().from(schema.transactions)).length,
    );
    expect(original).toBe(2);
  });

  it("replaces what the person had, and can restore onto the same person", async () => {
    const { db, backup } = await seeded();
    await withUser(db, A, (tx) => restoreFromBackup(tx, backup));
    const n = await withUser(db, A, async (tx) => ({
      tx: (await tx.select().from(schema.transactions)).length,
      accounts: (await tx.select().from(schema.accounts)).length,
    }));
    expect(n).toEqual({ tx: 2, accounts: 1 });
  });

  it("an older backup without category slugs gets them back for the default categories", async () => {
    const { db, backup } = await seeded();
    const old = JSON.parse(JSON.stringify(backup));
    old.version = 1;
    old.app = "kasboek"; // backups made before the rename carry the old name and must still restore
    old.tables.categories = [{ id: 1, name: "Boodschappen", type: "expense", sortOrder: 4 }];
    old.tables.categorisationRules = [];
    old.tables.budgets = [];
    old.tables.recurringItems = [];
    old.tables.recurringOccurrences = [];
    old.tables.transactions = [];
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, old));
    const cats = await withUser(db, TEST_USER_B, (tx) => tx.select().from(schema.categories));
    // The Savings and Taxes categories are added to any restore, since a backup from before they existed has none.
    expect(cats.filter((c) => c.type !== "savings" && c.slug !== "taxes")).toMatchObject([
      { name: "Boodschappen", slug: "groceries" },
    ]);
  });

  it("refuses files that are not backups, and a refused file changes nothing", async () => {
    const { db, backup } = await seeded();
    for (const bad of [
      null,
      "x",
      {},
      { app: "other", version: 1, tables: {} },
      { ...backup, version: 99 },
      { ...backup, tables: [] },
      { ...backup, tables: { ...backup.tables, transactions: "nope" } },
    ])
      await expect(withUser(db, A, (tx) => restoreFromBackup(tx, bad))).rejects.toBeInstanceOf(
        RestoreError,
      );
    const n = await withUser(
      db,
      A,
      async (tx) => (await tx.select().from(schema.transactions)).length,
    );
    expect(n).toBe(2);
  });

  it("brings back the savings goal and the amount already saved, and skips a damaged value", async () => {
    const { db, backup } = await seeded();
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
    expect(
      await withUser(db, TEST_USER_B, (tx) => tx.select().from(schema.userSettings)),
    ).toMatchObject([
      {
        savingsGoal: 500000,
        savingsStart: 120000,
        savingsAnchor: 20085,
        savingsAnchorDate: "2026-10-29",
      },
    ]);

    const edited = JSON.parse(JSON.stringify(backup));
    edited.tables.userSettings[0].savingsGoal = -5;
    edited.tables.userSettings[0].savingsStart = 2500;
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, edited));
    expect(
      await withUser(db, TEST_USER_B, (tx) => tx.select().from(schema.userSettings)),
    ).toMatchObject([{ savingsGoal: null, savingsStart: 2500 }]);
  });

  describe("the BTW clients", () => {
    const clientsOfB = async (db: Awaited<ReturnType<typeof seeded>>["db"]) =>
      (await withUser(db, TEST_USER_B, (tx) => getBtwClients(tx))).map(
        ({ name, paymentLag, vatPercent }) => ({ name, paymentLag, vatPercent }),
      );
    const featurn = (paymentLag: number) => ({ name: "Featurn", paymentLag, vatPercent: 21 });

    it("a version 11 backup brings back the whole list, in order", async () => {
      const { db, backup } = await seeded();
      expect(backup.version).toBe(11);
      expect(backup.tables.btwClients.map((c: { name: string }) => c.name)).toEqual([
        "Featurn",
        "Globex GmbH",
      ]);
      expect(backup.tables.btwClients[0]).not.toHaveProperty("userId");
      await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
      expect(await clientsOfB(db)).toEqual([
        featurn(1),
        { name: "Globex GmbH", paymentLag: 2, vatPercent: 0 },
      ]);
      // The original is untouched.
      expect((await withUser(db, A, (tx) => getBtwClients(tx))).length).toBe(2);
    });

    it("skips damaged entries, keeps an empty list empty, and never fails the restore over them", async () => {
      const { db, backup } = await seeded();
      const damaged = JSON.parse(JSON.stringify(backup));
      damaged.tables.btwClients = [
        { name: "Acme", paymentLag: 7, vatPercent: 21 },
        { name: "---", paymentLag: 0, vatPercent: 21 },
        { name: "Initech", paymentLag: 1, vatPercent: 9 },
        "Hooli",
        null,
        { name: "Wayne", paymentLag: 1, vatPercent: 0 },
      ];
      await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, damaged));
      expect(await clientsOfB(db)).toEqual([{ name: "Wayne", paymentLag: 1, vatPercent: 0 }]);

      const empty = JSON.parse(JSON.stringify(backup));
      empty.tables.btwClients = [];
      await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, empty));
      expect(await clientsOfB(db)).toEqual([]);

      // Not a list at all (hand-edited): built from the old fields, like an older backup.
      const broken = JSON.parse(JSON.stringify(backup));
      broken.tables.btwClients = { name: "Acme" };
      await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, broken));
      expect(await clientsOfB(db)).toEqual([featurn(1)]);
    });

    it("an older backup (version 10 or before) becomes one client from the old name and lag, as the migration did", async () => {
      const { db, backup } = await seeded();
      const old = (edit: (settings: Record<string, unknown>) => void, version = 10) => {
        const copy = JSON.parse(JSON.stringify(backup));
        delete copy.tables.btwClients;
        copy.version = version;
        edit(copy.tables.userSettings[0]);
        return copy;
      };
      const restore = async (b: unknown) => {
        await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, b));
        return await clientsOfB(db);
      };
      // Its own client and lag (the 0% Globex of version 11 does not exist in an old backup).
      expect(await restore(old((s) => (s.btwClient = "Acme BV")))).toEqual([
        { name: "Acme BV", paymentLag: 1, vatPercent: 21 },
      ]);
      // No client saved: the default, with the saved lag.
      expect(await restore(old((s) => (s.btwClient = null)))).toEqual([featurn(1)]);
      // Before version 9 there was no lag: 0.
      expect(await restore(old((s) => delete s.btwPaymentLag, 8))).toEqual([featurn(0)]);
      // Damaged values: the default name, lag 0.
      expect(
        await restore(
          old((s) => {
            s.btwClient = "---";
            s.btwPaymentLag = 7;
          }),
        ),
      ).toEqual([featurn(0)]);
      // No settings at all (a version 1 backup): the default client.
      const bare = old(() => {}, 1);
      delete bare.tables.userSettings;
      expect(await restore(bare)).toEqual([featurn(0)]);
    });
  });

  it("brings back whether the BTW pot is part of the savings; an older backup without it, or a damaged one, restores as off", async () => {
    const { db, backup } = await seeded();
    expect(backup.version).toBe(11);
    const pot = async () =>
      (await withUser(db, TEST_USER_B, (tx) => tx.select().from(schema.userSettings)))[0]
        ?.btwPotInSavings;
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
    expect(await pot()).toBe(true);

    const old = JSON.parse(JSON.stringify(backup));
    delete old.tables.userSettings[0].btwPotInSavings;
    old.version = 9;
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, old));
    expect(await pot()).toBe(false);

    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
    const damaged = JSON.parse(JSON.stringify(backup));
    damaged.tables.userSettings[0].btwPotInSavings = "yes";
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, damaged));
    expect(await pot()).toBe(false);
  });

  it("gives a backup from before the Savings category the category", async () => {
    const { db, backup } = await seeded();
    backup.tables.categories = backup.tables.categories.filter(
      (c: { type: string }) => c.type !== "savings",
    );
    await withUser(db, TEST_USER_B, (tx) => restoreFromBackup(tx, backup));
    const types = await withUser(db, TEST_USER_B, async (tx) =>
      (await tx.select().from(schema.categories)).map((c) => c.type),
    );
    expect(types.filter((t) => t === "savings")).toHaveLength(1);
  });
});
