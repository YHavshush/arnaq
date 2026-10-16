import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { catalogLookup, INCOME_SLUGS } from "./catalog-nl";

/**
 * Layer 4: categorise what is still open from the bundled list of Dutch shops and providers. The
 * result is marked `catalog` (automatic: shown as such and one click to undo). Skips internal
 * transfers, transactions the person undid, and payments of the wrong direction (money in for an
 * expense category, money out for an income one). Returns how many were categorised.
 */
export async function applyCatalog(db: Db, opts: { importId?: number } = {}): Promise<number> {
  const categories = await db
    .select({ id: schema.categories.id, slug: schema.categories.slug })
    .from(schema.categories)
    .where(isNotNull(schema.categories.slug));
  const bySlug = new Map(categories.map((c) => [c.slug!, c.id]));
  if (bySlug.size === 0) return 0;

  const where = [
    isNull(schema.transactions.categoryId),
    eq(schema.transactions.isInternalTransfer, false),
    or(
      isNull(schema.transactions.categorySource),
      ne(schema.transactions.categorySource, "undone"),
    )!,
  ];
  if (opts.importId !== undefined) where.push(eq(schema.transactions.importId, opts.importId));
  const todo = await db
    .select({
      id: schema.transactions.id,
      counterparty: schema.transactions.counterparty,
      description: schema.transactions.description,
      amount: schema.transactions.amount,
    })
    .from(schema.transactions)
    .where(and(...where));

  const idsByCategory = new Map<number, number[]>();
  let n = 0;
  for (const t of todo) {
    const slug = catalogLookup(t.counterparty, t.description);
    if (!slug) continue;
    if (INCOME_SLUGS.has(slug) !== t.amount > 0) continue;
    const categoryId = bySlug.get(slug);
    if (categoryId === undefined) continue;
    const ids = idsByCategory.get(categoryId);
    if (ids) ids.push(t.id);
    else idsByCategory.set(categoryId, [t.id]);
    n++;
  }
  for (const [categoryId, ids] of idsByCategory)
    for (let i = 0; i < ids.length; i += 500)
      await db
        .update(schema.transactions)
        .set({ categoryId, categorySource: "catalog", suggestedCategoryId: null })
        .where(inArray(schema.transactions.id, ids.slice(i, i + 500)));
  return n;
}
