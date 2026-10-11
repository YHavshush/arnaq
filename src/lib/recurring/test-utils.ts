// Test helpers: build transaction histories in code instead of adding big CSV fixtures.
import { asc, eq } from "drizzle-orm";
import { createDb, schema, type Db } from "@/db";

type NewTx = typeof schema.transactions.$inferInsert;
type NewItem = typeof schema.recurringItems.$inferInsert;

export function setup() {
  const db = createDb(":memory:");
  const [account] = db
    .insert(schema.accounts)
    .values({ name: "Rabo", bank: "rabobank", iban: "NL00RABO0000000001" })
    .returning()
    .all();
  let n = 0;

  /** Insert a transaction directly. Amount in signed cents. */
  const tx = (date: string, amount: number, extra: Partial<NewTx> = {}) =>
    db
      .insert(schema.transactions)
      .values({ accountId: account.id, date, amount, importHash: `h${n++}`, ...extra })
      .returning()
      .get();

  /** Insert an item directly, without generating or matching anything. */
  const addItem = (extra: Partial<NewItem> = {}) =>
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
      .returning()
      .get();

  /** Pretend these months were uploaded. */
  const cover = (...months: string[]) => {
    for (const month of months)
      db.insert(schema.imports).values({ accountId: account.id, month, filename: "t.csv" }).run();
  };

  const cat = (name: string) =>
    db.select().from(schema.categories).where(eq(schema.categories.name, name)).get()!.id;

  const occurrences = (itemId: number) =>
    db
      .select()
      .from(schema.recurringOccurrences)
      .where(eq(schema.recurringOccurrences.recurringItemId, itemId))
      .orderBy(asc(schema.recurringOccurrences.month))
      .all();

  const occ = (itemId: number, month: string) =>
    occurrences(itemId).find((o) => o.month === month)!;

  const getTx = (id: number) =>
    db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()!;

  return { db, account, tx, addItem, cover, cat, occurrences, occ, getTx };
}

/** Everything matching can change, for "nothing changed" assertions. */
export function snapshot(db: Db) {
  return {
    occurrences: db
      .select()
      .from(schema.recurringOccurrences)
      .orderBy(asc(schema.recurringOccurrences.id))
      .all(),
    transactions: db.select().from(schema.transactions).orderBy(asc(schema.transactions.id)).all(),
    items: db.select().from(schema.recurringItems).orderBy(asc(schema.recurringItems.id)).all(),
  };
}
