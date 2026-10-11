import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@/db";

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
export function applyRules(db: Db, opts: { importId?: number } = {}): number {
  const rules = sortRules(db.select().from(schema.categorisationRules).all());
  if (rules.length === 0) return 0;

  const where = [
    isNull(schema.transactions.categoryId),
    eq(schema.transactions.isInternalTransfer, false),
  ];
  if (opts.importId !== undefined) where.push(eq(schema.transactions.importId, opts.importId));
  const todo = db
    .select()
    .from(schema.transactions)
    .where(and(...where))
    .all();

  let n = 0;
  for (const t of todo) {
    const rule = matchRule(rules, t);
    if (!rule) continue;
    db.update(schema.transactions)
      .set({ categoryId: rule.categoryId })
      .where(eq(schema.transactions.id, t.id))
      .run();
    n++;
  }
  return n;
}

/** Transactions that need a human: no category yet, or not in the account's currency. */
export function getNeedsReview(db: Db) {
  const rows = db
    .select({ t: schema.transactions, accountCurrency: schema.accounts.currency })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(eq(schema.transactions.isInternalTransfer, false))
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
    .all();
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
}

export interface AssignResult {
  ruleId: number | null;
  alsoCategorised: number;
}

export class CategoriseError extends Error {}

/** Set a transaction's category by hand, optionally learning a rule from it. */
export function assignCategory(
  db: Db,
  transactionId: number,
  categoryId: number,
  opts: AssignOptions = {},
): AssignResult {
  const t = db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.id, transactionId))
    .get();
  if (!t) throw new CategoriseError(`Transaction ${transactionId} does not exist.`);
  const category = db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.id, categoryId))
    .get();
  if (!category) throw new CategoriseError(`Category ${categoryId} does not exist.`);

  db.update(schema.transactions)
    .set({ categoryId, isInternalTransfer: category.type === "transfer" })
    .where(eq(schema.transactions.id, transactionId))
    .run();

  if (!opts.createRule) return { ruleId: null, alsoCategorised: 0 };

  const pattern = (opts.pattern ?? t.counterparty ?? t.description ?? "").trim();
  if (!pattern) throw new CategoriseError("Cannot create a rule without a pattern.");
  const [rule] = db
    .insert(schema.categorisationRules)
    .values({ pattern, categoryId, priority: opts.priority ?? 10 })
    .returning()
    .all();
  return { ruleId: rule.id, alsoCategorised: applyRules(db) };
}

export function deleteRule(db: Db, ruleId: number): void {
  db.delete(schema.categorisationRules).where(eq(schema.categorisationRules.id, ruleId)).run();
}
