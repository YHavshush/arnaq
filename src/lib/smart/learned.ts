import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { merchantKey } from "./merchant";

const BATCH = 500;

/** Sources that can be replaced when the person corrects a shop: automatic ones, never their own. */
export const REPLACEABLE_SOURCES = ["catalog", "history", "model", "confirmed", "undone"] as const;

/**
 * Fill in the merchant key of transactions that do not have one yet (older imports). An empty key is
 * stored as "" so the row is not looked at again. Returns how many rows were filled.
 */
export async function ensureMerchantKeys(db: Db): Promise<number> {
  let filled = 0;
  for (;;) {
    const rows = await db
      .select({
        id: schema.transactions.id,
        counterparty: schema.transactions.counterparty,
        description: schema.transactions.description,
      })
      .from(schema.transactions)
      .where(isNull(schema.transactions.merchantKey))
      .limit(BATCH);
    if (rows.length === 0) return filled;
    const byKey = new Map<string, number[]>();
    for (const r of rows) {
      const key = merchantKey(r.counterparty, r.description);
      const ids = byKey.get(key);
      if (ids) ids.push(r.id);
      else byKey.set(key, [r.id]);
    }
    for (const [key, ids] of byKey)
      await db
        .update(schema.transactions)
        .set({ merchantKey: key })
        .where(inArray(schema.transactions.id, ids));
    filled += rows.length;
  }
}

/** The person's own choice for a shop, remembered. Replaces an earlier choice or a model's guess. */
export async function learnLabel(db: Db, key: string, categoryId: number): Promise<void> {
  if (!key) return;
  await db
    .insert(schema.merchantLabels)
    .values({ merchantKey: key, categoryId, source: "user" })
    .onConflictDoUpdate({
      target: [schema.merchantLabels.userId, schema.merchantLabels.merchantKey],
      set: {
        categoryId,
        source: "user",
        provider: null,
        optionsHash: null,
        updatedAt: new Date().toISOString(),
      },
    });
}

/** The person's remembered shops: key -> category id (labels the model made are not included). */
export async function getLearnedLabels(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(schema.merchantLabels)
    .where(eq(schema.merchantLabels.source, "user"));
  const out = new Map<string, number>();
  for (const r of rows) if (r.categoryId !== null) out.set(r.merchantKey, r.categoryId);
  return out;
}

async function setCategory(db: Db, ids: number[], categoryId: number, source: string) {
  for (let i = 0; i < ids.length; i += BATCH)
    await db
      .update(schema.transactions)
      .set({
        categoryId,
        categorySource: source as (typeof schema.CATEGORY_SOURCES)[number],
        suggestedCategoryId: null,
      })
      .where(inArray(schema.transactions.id, ids.slice(i, i + BATCH)));
}

/**
 * Apply what the person has taught: uncategorised transactions of a remembered shop get that
 * shop's category (source `learned`). Never touches a transaction that has a category, an internal
 * transfer, or a category the person chose. Returns how many were categorised.
 */
export async function applyLearned(db: Db, opts: { importId?: number } = {}): Promise<number> {
  const labels = await getLearnedLabels(db);
  if (labels.size === 0) return 0;
  await ensureMerchantKeys(db);
  const where = [
    isNull(schema.transactions.categoryId),
    eq(schema.transactions.isInternalTransfer, false),
  ];
  if (opts.importId !== undefined) where.push(eq(schema.transactions.importId, opts.importId));
  const todo = await db
    .select({ id: schema.transactions.id, key: schema.transactions.merchantKey })
    .from(schema.transactions)
    .where(and(...where));
  const byCategory = new Map<number, number[]>();
  for (const t of todo) {
    const categoryId = t.key ? labels.get(t.key) : undefined;
    if (categoryId === undefined) continue;
    const ids = byCategory.get(categoryId);
    if (ids) ids.push(t.id);
    else byCategory.set(categoryId, [t.id]);
  }
  let n = 0;
  for (const [categoryId, ids] of byCategory) {
    await setCategory(db, ids, categoryId, "learned");
    n += ids.length;
  }
  return n;
}

/**
 * The person corrected a shop: every other transaction of that shop that a machine categorised (or
 * left open after an undo) follows the correction. Their own choices stay. Returns how many changed.
 */
export async function propagateLabel(
  db: Db,
  key: string,
  categoryId: number,
  exceptId: number,
): Promise<number> {
  if (!key) return 0;
  const rows = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.merchantKey, key),
        eq(schema.transactions.isInternalTransfer, false),
        or(
          isNull(schema.transactions.categoryId),
          inArray(schema.transactions.categorySource, [...REPLACEABLE_SOURCES]),
        ),
      ),
    );
  const ids = rows.map((r) => r.id).filter((id) => id !== exceptId);
  if (ids.length > 0) await setCategory(db, ids, categoryId, "learned");
  return ids.length;
}

/** Forget a remembered shop. Only the person's own labels can be forgotten here. */
export async function forgetLabel(db: Db, id: number): Promise<void> {
  await db
    .delete(schema.merchantLabels)
    .where(and(eq(schema.merchantLabels.id, id), eq(schema.merchantLabels.source, "user")));
}
