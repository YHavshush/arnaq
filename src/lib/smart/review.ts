import { and, count, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { AUTOMATIC_SOURCES } from "@/db/schema";

const AUTOMATIC = [...AUTOMATIC_SOURCES];

/** The most recent transactions a machine categorised, for the person to check. */
export async function getAutomatic(db: Db, limit = 50) {
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(schema.transactions)
      .where(inArray(schema.transactions.categorySource, AUTOMATIC))
      .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
      .limit(limit),
    db
      .select({ total: count() })
      .from(schema.transactions)
      .where(inArray(schema.transactions.categorySource, AUTOMATIC)),
  ]);
  return { rows, total };
}

/**
 * "That is wrong": clear the category of a machine-made choice and mark it undone, so automation
 * leaves it alone and it shows up in the list of things to sort. Only automatic choices can be undone
 * this way (a person's own choice is changed by choosing another category). Returns whether it changed.
 */
export async function undoAutomatic(db: Db, transactionId: number): Promise<boolean> {
  const rows = await db
    .update(schema.transactions)
    .set({ categoryId: null, categorySource: "undone", suggestedCategoryId: null })
    .where(
      and(
        eq(schema.transactions.id, transactionId),
        inArray(schema.transactions.categorySource, AUTOMATIC),
      ),
    )
    .returning({ id: schema.transactions.id });
  return rows.length > 0;
}

/** "All correct": the automatic choices shown are approved; they stop being marked automatic. */
export async function confirmAutomatic(db: Db, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(schema.transactions)
    .set({ categorySource: "confirmed" })
    .where(
      and(
        inArray(schema.transactions.id, ids),
        inArray(schema.transactions.categorySource, AUTOMATIC),
      ),
    )
    .returning({ id: schema.transactions.id });
  return rows.length;
}
