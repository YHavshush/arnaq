import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema, type Db } from "@/db";
import type { PgTable } from "drizzle-orm/pg-core";
import { setBudget } from "@/lib/budget/budgets";
import { createRecurringItem, updateRecurringItem } from "@/lib/recurring/items";
import {
  SAMPLE_BUDGETS,
  SAMPLE_IBAN,
  SAMPLE_ITEMS,
  SampleError,
  canLoadSample,
  clearSample,
  hasSample,
  loadSample,
} from "./sample";

const TODAY = "2026-10-21";
const n = async (db: Db, table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;

describe("sample data", () => {
  it("fills an empty account with a marked sample account, months of payments, fixed items and budgets", async () => {
    const db = await createDb(":memory:");
    expect(await hasSample(db)).toBe(false);
    const { transactions } = await loadSample(db, TODAY);
    expect(transactions).toBeGreaterThan(80);
    expect(await hasSample(db)).toBe(true);

    const [account] = await db.select().from(schema.accounts);
    expect(account).toMatchObject({ iban: SAMPLE_IBAN, bank: "rabobank" });
    expect(await n(db, schema.transactions)).toBe(transactions);
    expect(await n(db, schema.imports)).toBe(5); // this month and the four before
    expect(await n(db, schema.recurringItems)).toBe(SAMPLE_ITEMS.length);
    expect(await n(db, schema.budgets)).toBe(SAMPLE_BUDGETS.length * 8);
    expect(await n(db, schema.monthlyTotalBudget)).toBe(8);
    // Nothing is in the future, and every invented payment is sorted.
    const rows = await db.select().from(schema.transactions);
    expect(rows.every((r) => r.date <= TODAY)).toBe(true);
    expect(rows.every((r) => r.categoryId !== null)).toBe(true); // nothing is left to sort
  });

  it("is the same every time, and loading twice adds nothing", async () => {
    const a = await createDb(":memory:");
    const b = await createDb(":memory:");
    const first = await loadSample(a, TODAY);
    expect(await loadSample(b, TODAY)).toEqual(first);
    expect(await loadSample(a, TODAY)).toEqual({ transactions: 0 });
    expect(await n(a, schema.transactions)).toBe(first.transactions);
  });

  it("refuses an account that already has transactions, so sample and real data never mix", async () => {
    const db = await createDb(":memory:");
    const [account] = await db
      .insert(schema.accounts)
      .values({ name: "Rabo", bank: "rabobank" })
      .returning();
    await db
      .insert(schema.transactions)
      .values({ accountId: account.id, date: "2026-10-01", amount: -100, importHash: "mine" });
    await expect(loadSample(db, TODAY)).rejects.toBeInstanceOf(SampleError);
    expect(await hasSample(db)).toBe(false);
    expect(await n(db, schema.transactions)).toBe(1);
  });

  it("clears everything it made in one step, and clearing twice is harmless", async () => {
    const db = await createDb(":memory:");
    await loadSample(db, TODAY);
    expect(await clearSample(db, TODAY)).toBe(true);
    for (const t of [
      schema.accounts,
      schema.transactions,
      schema.imports,
      schema.recurringItems,
      schema.recurringOccurrences,
      schema.budgets,
      schema.monthlyTotalBudget,
    ])
      expect(await n(db, t)).toBe(0);
    expect(await hasSample(db)).toBe(false);
    expect(await clearSample(db, TODAY)).toBe(false);
    // The categories (the person's own setup) are still there.
    expect(await n(db, schema.categories)).toBeGreaterThan(10);
  });

  it("clearing keeps what the person made themselves, and a sample can be loaded again afterwards", async () => {
    const db = await createDb(":memory:");
    await loadSample(db, TODAY);
    const cat = async (name: string) =>
      (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;
    // Their own fixed item, and a budget they changed to their real amount.
    await createRecurringItem(
      db,
      {
        name: "Gym",
        type: "expense",
        matchCounterparty: "Eigen Gym",
        expectedAmount: 4000,
        dayOfMonth: 3,
        categoryId: await cat("Sport"),
        startDate: "2026-06-01",
        tolerance: 0,
      },
      { today: TODAY },
    );
    await setBudget(db, await cat("Boodschappen"), "2026-10", 33300);
    await clearSample(db, TODAY);
    expect((await db.select().from(schema.recurringItems)).map((i) => i.name)).toEqual(["Gym"]);
    const kept = await db.select().from(schema.budgets);
    expect(kept).toMatchObject([{ month: "2026-10", amount: 33300 }]);
    // Their own fixed item and budget are still there, so this is no longer an empty account for a new sample.
    expect((await db.select().from(schema.transactions)).length).toBe(0);
    await expect(loadSample(db, TODAY)).rejects.toBeInstanceOf(SampleError);
  });

  it("clears even when a sample fixed item was edited or a person's own item matches a sample shop", async () => {
    const db = await createDb(":memory:");
    await loadSample(db, TODAY);
    const cat = async (name: string) =>
      (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;
    // Editing a sample item (the banner invites it) links its occurrences to sample transactions...
    const spotify = (await db.select().from(schema.recurringItems)).find(
      (i) => i.name === "Spotify",
    )!;
    await updateRecurringItem(db, spotify.id, { expectedAmount: 1199 }, { today: TODAY });
    // ...and so does a person's own item that matches a sample shop.
    await createRecurringItem(
      db,
      {
        name: "Gym",
        type: "expense",
        matchCounterparty: "Basic-Fit",
        expectedAmount: 2999,
        dayOfMonth: 5,
        categoryId: await cat("Sport"),
        startDate: "2026-06-01",
        tolerance: 0,
      },
      { today: TODAY },
    );
    await expect(clearSample(db, TODAY)).resolves.toBe(true);
    expect(await n(db, schema.transactions)).toBe(0);
    // Both survive: the edited Spotify (a changed item is theirs now) and their own Gym.
    expect((await db.select().from(schema.recurringItems)).map((i) => i.name).sort()).toEqual([
      "Gym",
      "Spotify",
    ]);
    // No occurrence points at a transaction that is gone.
    expect(
      (await db.select().from(schema.recurringOccurrences)).every((o) => o.transactionId === null),
    ).toBe(true);
  });

  it("is offered only to an account with nothing of its own: no transactions, fixed items or budgets", async () => {
    const withItem = await createDb(":memory:");
    await createRecurringItem(
      withItem,
      {
        name: "Huur",
        type: "expense",
        matchCounterparty: "X",
        expectedAmount: 1000,
        dayOfMonth: 1,
        categoryId: null,
        startDate: "2026-06-01",
        tolerance: 0,
      },
      { today: TODAY },
    );
    await expect(loadSample(withItem, TODAY)).rejects.toBeInstanceOf(SampleError);
    expect(await canLoadSample(withItem)).toBe(false);

    const withBudget = await createDb(":memory:");
    const [c] = await withBudget.select().from(schema.categories);
    await setBudget(withBudget, c.id, "2026-10", 5000);
    await expect(loadSample(withBudget, TODAY)).rejects.toBeInstanceOf(SampleError);

    const empty = await createDb(":memory:");
    expect(await canLoadSample(empty)).toBe(true);
    await loadSample(empty, TODAY);
    expect(await canLoadSample(empty)).toBe(false); // already loaded
  });

  it("clearing leaves a budget outside the sample's months alone, even with the same amount", async () => {
    const db = await createDb(":memory:");
    await loadSample(db, TODAY);
    const food = (await one(
      db.select().from(schema.categories).where(eq(schema.categories.name, "Boodschappen")),
    ))!.id;
    await setBudget(db, food, "2027-06", 28000); // the sample's amount, but a month the sample never filled
    await clearSample(db, TODAY);
    expect(await db.select().from(schema.budgets)).toMatchObject([
      { month: "2027-06", amount: 28000 },
    ]);
  });
});
