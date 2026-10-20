import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { first, schema, type Db } from "@/db";
import { merchantKey } from "@/lib/smart/merchant";
import {
  directionOf,
  releaseLearnedTransfers,
  learnLabel,
  propagateLabel,
  transferKey,
} from "@/lib/smart/learned";

export interface Rule {
  id: number;
  pattern: string;
  categoryId: number;
  priority: number;
}

interface Categorisable {
  counterparty: string | null;
  description: string | null;
}

const haystack = (t: Categorisable) =>
  `${t.counterparty ?? ""} ${t.description ?? ""}`.toLowerCase();

/** Rules in the order they are tried: higher priority first, then longer pattern, then oldest. */
export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort(
    (a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length || a.id - b.id,
  );
}

/** First matching rule for a transaction, or undefined. Rules must already be sorted. */
export function matchRule(sortedRules: Rule[], t: Categorisable): Rule | undefined {
  const text = haystack(t);
  return sortedRules.find((r) => r.pattern.trim() !== "" && text.includes(r.pattern.toLowerCase()));
}

/**
 * Categorise uncategorised transactions with the rules. Never touches a transaction that
 * already has a category (so manual choices stick) or an internal transfer.
 * Returns the number of transactions categorised.
 */
export async function applyRules(db: Db, opts: { importId?: number } = {}): Promise<number> {
  const rules = sortRules(await db.select().from(schema.categorisationRules));
  if (rules.length === 0) return 0;

  const where = [
    isNull(schema.transactions.categoryId),
    eq(schema.transactions.isInternalTransfer, false),
  ];
  if (opts.importId !== undefined) where.push(eq(schema.transactions.importId, opts.importId));
  const todo = await db
    .select()
    .from(schema.transactions)
    .where(and(...where));

  // Group by target category so each category is one UPDATE per chunk, not one per transaction.
  const idsByCategory = new Map<number, number[]>();
  let n = 0;
  for (const t of todo) {
    const rule = matchRule(rules, t);
    if (!rule) continue;
    const ids = idsByCategory.get(rule.categoryId);
    if (ids) ids.push(t.id);
    else idsByCategory.set(rule.categoryId, [t.id]);
    n++;
  }
  for (const [categoryId, ids] of idsByCategory) {
    for (let i = 0; i < ids.length; i += 500) {
      await db
        .update(schema.transactions)
        .set({ categoryId, categorySource: "rule", suggestedCategoryId: null })
        .where(inArray(schema.transactions.id, ids.slice(i, i + 500)));
    }
  }
  return n;
}

/** Transactions that need a human: no category yet, or not in the account's currency. */
export async function getNeedsReview(db: Db) {
  const rows = await db
    .select({ t: schema.transactions, accountCurrency: schema.accounts.currency })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(eq(schema.transactions.isInternalTransfer, false))
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.id));
  return rows
    .filter(({ t, accountCurrency }) => t.categoryId === null || t.currency !== accountCurrency)
    .map(({ t, accountCurrency }) => ({
      ...t,
      reason:
        t.currency !== accountCurrency ? ("foreign-currency" as const) : ("uncategorised" as const),
    }));
}

export interface AssignOptions {
  /** Create a rule from this transaction so future (and other uncategorised) ones match. */
  createRule?: boolean;
  /** Rule pattern. Defaults to the counterparty (or description when there is none). */
  pattern?: string;
  priority?: number;
  /**
   * Remember this shop: the same shop gets this category next time, and what a machine guessed for
   * it earlier follows. Needs a counterparty or description to recognise the shop by.
   */
  learn?: boolean;
}

export interface AssignResult {
  ruleId: number | null;
  alsoCategorised: number;
}

export class CategoriseError extends Error {}

/** Set a transaction's category by hand, optionally learning a rule from it. */
export async function assignCategory(
  db: Db,
  transactionId: number,
  categoryId: number,
  opts: AssignOptions = {},
): Promise<AssignResult> {
  const t = await first(
    db.select().from(schema.transactions).where(eq(schema.transactions.id, transactionId)),
  );
  if (!t) throw new CategoriseError(`Transaction ${transactionId} does not exist.`);
  const category = await first(
    db.select().from(schema.categories).where(eq(schema.categories.id, categoryId)),
  );
  if (!category) throw new CategoriseError(`Category ${categoryId} does not exist.`);

  const key = merchantKey(t.counterparty, t.description);
  await db
    .update(schema.transactions)
    .set({
      categoryId,
      isInternalTransfer: category.type === "transfer",
      categorySource: "user",
      suggestedCategoryId: null,
      merchantKey: key,
    })
    .where(eq(schema.transactions.id, transactionId));

  let learned = 0;
  if (opts.learn && key) {
    const direction = directionOf(t.amount);
    if (category.type === "transfer") {
      // Only this direction: a top-up from "Apple Pay" is not a purchase at "Apple Pay". Money of
      // zero euro has no direction, so nothing is remembered from it.
      if (direction) {
        await learnLabel(db, transferKey(key, direction), categoryId);
        learned = await propagateLabel(db, key, categoryId, transactionId, direction);
      }
    } else {
      if (direction)
        learned += await releaseLearnedTransfers(db, key, direction, categoryId, transactionId);
      await learnLabel(db, key, categoryId);
      learned += await propagateLabel(db, key, categoryId, transactionId);
    }
  }
  if (!opts.createRule) return { ruleId: null, alsoCategorised: learned };

  const pattern = (opts.pattern ?? t.counterparty ?? t.description ?? "").trim();
  if (!pattern) throw new CategoriseError("Cannot create a rule without a pattern.");
  const [rule] = await db
    .insert(schema.categorisationRules)
    .values({ pattern, categoryId, priority: opts.priority ?? 10 })
    .returning();
  return { ruleId: rule.id, alsoCategorised: learned + (await applyRules(db)) };
}

export async function deleteRule(db: Db, ruleId: number): Promise<void> {
  await db.delete(schema.categorisationRules).where(eq(schema.categorisationRules.id, ruleId));
}
