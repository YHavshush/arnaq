import { and, between, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { MAX_CENTS } from "@/lib/money";

export class BudgetError extends Error {}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new BudgetError(`Invalid month "${month}", use YYYY-MM.`);
}

function assertCents(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_CENTS) {
    throw new BudgetError("Budget amount must be a non-negative integer number of cents.");
  }
}

export function setBudget(db: Db, categoryId: number, month: string, amount: number): void {
  assertMonth(month);
  assertCents(amount);
  db.insert(schema.budgets)
    .values({ categoryId, month, amount })
    .onConflictDoUpdate({
      target: [schema.budgets.categoryId, schema.budgets.month],
      set: { amount },
    })
    .run();
}

export function clearBudget(db: Db, categoryId: number, month: string): void {
  db.delete(schema.budgets)
    .where(and(eq(schema.budgets.categoryId, categoryId), eq(schema.budgets.month, month)))
    .run();
}

/** Set (or with null, remove) the optional overall budget for a month. */
export function setTotalBudget(db: Db, month: string, amount: number | null): void {
  assertMonth(month);
  if (amount === null) {
    db.delete(schema.monthlyTotalBudget).where(eq(schema.monthlyTotalBudget.month, month)).run();
    return;
  }
  assertCents(amount);
  db.insert(schema.monthlyTotalBudget)
    .values({ month, amount })
    .onConflictDoUpdate({ target: schema.monthlyTotalBudget.month, set: { amount } })
    .run();
}

/** Copy all category budgets (and the total) from one month to another, overwriting. */
export function copyBudgets(db: Db, fromMonth: string, toMonth: string): number {
  assertMonth(fromMonth);
  assertMonth(toMonth);
  const rows = db.select().from(schema.budgets).where(eq(schema.budgets.month, fromMonth)).all();
  for (const r of rows) setBudget(db, r.categoryId, toMonth, r.amount);
  const total = db
    .select()
    .from(schema.monthlyTotalBudget)
    .where(eq(schema.monthlyTotalBudget.month, fromMonth))
    .get();
  if (total) setTotalBudget(db, toMonth, total.amount);
  return rows.length;
}

export interface MonthBudgets {
  /** Category id -> budget in cents, only for categories with a budget that month. */
  byCategory: Map<number, number>;
  /** The explicit monthly total, or null when none is set. */
  total: number | null;
}

/** Budgets for every month in fromMonth..toMonth (inclusive) that has any. Two queries. */
export function getBudgetsByMonth(
  db: Db,
  fromMonth: string,
  toMonth: string,
): Map<string, MonthBudgets> {
  assertMonth(fromMonth);
  assertMonth(toMonth);
  const out = new Map<string, MonthBudgets>();
  const at = (month: string) => {
    let b = out.get(month);
    if (!b) out.set(month, (b = { byCategory: new Map(), total: null }));
    return b;
  };
  for (const r of db
    .select()
    .from(schema.budgets)
    .where(between(schema.budgets.month, fromMonth, toMonth))
    .all())
    at(r.month).byCategory.set(r.categoryId, r.amount);
  for (const r of db
    .select()
    .from(schema.monthlyTotalBudget)
    .where(between(schema.monthlyTotalBudget.month, fromMonth, toMonth))
    .all())
    at(r.month).total = r.amount;
  return out;
}

/**
 * The total budget of a month: the explicit total when set, else the sum of the category
 * budgets, or null when there are none.
 */
export function resolveTotalBudget(explicit: number | null, categoryBudgets: (number | null)[]) {
  if (explicit !== null) return explicit;
  const set = categoryBudgets.filter((b): b is number => b !== null);
  return set.length > 0 ? set.reduce((s, b) => s + b, 0) : null;
}
