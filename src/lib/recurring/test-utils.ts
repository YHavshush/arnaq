// Test helpers: build transaction histories in code instead of adding big CSV fixtures.
import { asc, eq } from "drizzle-orm";
import { one, createDb, schema, type Db } from "@/db";

type NewTx = typeof schema.transactions.$inferInsert;
type NewItem = typeof schema.recurringItems.$inferInsert;

export async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "Rabo", bank: "rabobank", iban: "NL00RABO0000000001" })
    .returning();
  let n = 0;

  /** Insert a transaction directly. Amount in signed cents. */
  const tx = async (date: string, amount: number, extra: Partial<NewTx> = {}) =>
    await one(
      db
        .insert(schema.transactions)
        .values({ accountId: account.id, date, amount, importHash: `h${n++}`, ...extra })
        .returning(),
    );

  /** Insert an item directly, without generating or matching anything. */
  const addItem = async (extra: Partial<NewItem> = {}) =>
    await one(
      db
        .insert(schema.recurringItems)
        .values({
          name: "Spotify",
          type: "expense",
          matchCounterparty: "Spotify",
          expectedAmount: 999,
          tolerance: 0,
          dayOfMonth: 10,
          startDate: "2026-01-01",
          ...extra,
        })
        .returning(),
    );

  /** Pretend these months were uploaded. */
  const cover = async (...months: string[]) => {
    for (const month of months)
      await db.insert(schema.imports).values({ accountId: account.id, month, filename: "t.csv" });
  };

  const cat = async (name: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;

  const occurrences = async (itemId: number) =>
    await db
      .select()
      .from(schema.recurringOccurrences)
      .where(eq(schema.recurringOccurrences.recurringItemId, itemId))
      .orderBy(asc(schema.recurringOccurrences.month));

  const occ = async (itemId: number, month: string) =>
    (await occurrences(itemId)).find((o) => o.month === month)!;

  const getTx = async (id: number) =>
    (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, id))))!;

  return { db, account, tx, addItem, cover, cat, occurrences, occ, getTx };
}

/** Everything matching can change, for "nothing changed" assertions. */
export async function snapshot(db: Db) {
  return {
    occurrences: await db
      .select()
      .from(schema.recurringOccurrences)
      .orderBy(asc(schema.recurringOccurrences.id)),
    transactions: await db.select().from(schema.transactions).orderBy(asc(schema.transactions.id)),
    items: await db.select().from(schema.recurringItems).orderBy(asc(schema.recurringItems.id)),
  };
}
