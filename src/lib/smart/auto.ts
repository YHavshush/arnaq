import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { catalogLookup, catalogSuggestion, INCOME_SLUGS } from "./catalog-nl";
import { decide } from "./decide";
import { historyLookup, type HistoryEntry } from "./history";
import { ensureMerchantKeys } from "./learned";
import { isReversal } from "./reversal";
import { findRefundPayment, loadPayments } from "./refund";

/** Sources that come from the person (their choice, a shop they taught, a rule or fixed cost they set up). */
const TRUSTED = ["user", "learned", "rule", "recurring", "confirmed"] as const;

export interface AutoResult {
  /** Categorised by the catalog or the history. */
  applied: number;
  /** Left open with a "Probably X?" suggestion. */
  suggested: number;
}

/** What the person has categorised before, per shop and category. Their own decisions only. */
export async function loadHistory(db: Db): Promise<HistoryEntry[]> {
  const rows = await db
    .select({
      key: schema.transactions.merchantKey,
      categoryId: schema.transactions.categoryId,
    })
    .from(schema.transactions)
    .where(
      and(
        isNotNull(schema.transactions.categoryId),
        isNotNull(schema.transactions.merchantKey),
        ne(schema.transactions.merchantKey, ""),
        inArray(schema.transactions.categorySource, [...TRUSTED]),
      ),
    );
  const counts = new Map<string, HistoryEntry>();
  for (const r of rows) {
    const id = `${r.key}\u0000${r.categoryId}`;
    const entry = counts.get(id) ?? { key: r.key!, categoryId: r.categoryId!, count: 0 };
    entry.count++;
    counts.set(id, entry);
  }
  return [...counts.values()];
}

/**
 * Layers 4 and 5: categorise what is still open from the bundled catalog and from the person's own
 * history (see `decide`). Applied ones are marked `catalog` or `history` (automatic: shown as such,
 * one click to undo); unsure ones get a suggestion. Skips internal transfers, transactions the person
 * undid, and categories of the wrong direction (money in for an expense category and the other way).
 */
export async function applyAutomatic(
  db: Db,
  opts: { importId?: number } = {},
): Promise<AutoResult> {
  await ensureMerchantKeys(db);
  const categories = await db
    .select({
      id: schema.categories.id,
      slug: schema.categories.slug,
      type: schema.categories.type,
    })
    .from(schema.categories);
  const typeOf = new Map(categories.map((c) => [c.id, c.type]));
  const bySlug = new Map(categories.filter((c) => c.slug).map((c) => [c.slug!, c.id]));
  const history = await loadHistory(db);
  const payments = await loadPayments(db);

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
      key: schema.transactions.merchantKey,
      date: schema.transactions.date,
    })
    .from(schema.transactions)
    .where(and(...where));

  const apply = new Map<string, number[]>(); // "categoryId|source" -> transaction ids
  const suggest = new Map<number, number[]>(); // categoryId -> transaction ids
  const push = <K>(map: Map<K, number[]>, k: K, id: number) => {
    const ids = map.get(k);
    if (ids) ids.push(id);
    else map.set(k, [id]);
  };

  let applied = 0;
  let suggested = 0;
  for (const t of todo) {
    // A reversal of a payment (a bounced direct debit, a refund) is money in for an expense category.
    const reversal = t.amount > 0 && isReversal(t.description);
    const wantsType = t.amount > 0 && !reversal ? "income" : "expense";
    // Savings fits money in and out (a deposit and a withdrawal); the others must match the direction.
    const fits = (categoryId: number) =>
      typeOf.get(categoryId) === wantsType || typeOf.get(categoryId) === "savings";
    const slug = catalogLookup(t.counterparty, t.description);
    const catalogId =
      slug && (slug === "savings" || reversal || INCOME_SLUGS.has(slug) === t.amount > 0)
        ? (bySlug.get(slug) ?? null)
        : null;
    const hintSlug = slug === null ? catalogSuggestion(t.counterparty, t.description) : null;
    const hintId =
      hintSlug && INCOME_SLUGS.has(hintSlug) === t.amount > 0 ? bySlug.get(hintSlug) : null;
    const decision = decide({
      catalog: catalogId !== null && fits(catalogId) ? catalogId : null,
      hint: hintId != null && fits(hintId) ? hintId : null,
      history: historyLookup(t.key ?? "", history, fits),
    });
    // Money in from a shop that was paid shortly before, for no more than that payment, is a refund: it goes
    // to the category of the payment, so the spending nets out. The same amount is certain enough to apply;
    // less (a partial refund, one item sent back) is offered.
    if (t.amount > 0 && !reversal && decision.kind !== "apply") {
      const refund = findRefundPayment(payments, t);
      if (refund && typeOf.get(refund.payment.categoryId) === "expense") {
        if (refund.exact) {
          push(apply, `${refund.payment.categoryId}|history`, t.id);
          applied++;
        } else {
          push(suggest, refund.payment.categoryId, t.id);
          suggested++;
        }
        continue;
      }
    }
    if (decision.kind === "apply") {
      push(apply, `${decision.categoryId}|${decision.source}`, t.id);
      applied++;
    } else if (decision.kind === "suggest") {
      push(suggest, decision.categoryId, t.id);
      suggested++;
    }
  }

  for (const [target, ids] of apply) {
    const [categoryId, source] = target.split("|");
    for (let i = 0; i < ids.length; i += 500)
      await db
        .update(schema.transactions)
        .set({
          categoryId: Number(categoryId),
          categorySource: source as "catalog" | "history",
          suggestedCategoryId: null,
          // Money into or out of savings is neither income nor spending.
          ...(typeOf.get(Number(categoryId)) === "savings" ? { isInternalTransfer: true } : {}),
        })
        .where(inArray(schema.transactions.id, ids.slice(i, i + 500)));
  }
  for (const [categoryId, ids] of suggest)
    for (let i = 0; i < ids.length; i += 500)
      await db
        .update(schema.transactions)
        .set({ suggestedCategoryId: categoryId })
        .where(inArray(schema.transactions.id, ids.slice(i, i + 500)));
  return { applied, suggested };
}
