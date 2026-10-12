import { and, between, eq } from "drizzle-orm";
import { first, schema, type Db } from "@/db";
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

export async function setBudget(
  db: Db,
  categoryId: number,
  month: string,
  amount: number,
): Promise<void> {
  assertMonth(month);
  assertCents(amount);
  await db
    .insert(schema.budgets)
    .values({ categoryId, month, amount })
    .onConflictDoUpdate({
      target: [schema.budgets.userId, schema.budgets.categoryId, schema.budgets.month],
      set: { amount },
    });
}

export async function clearBudget(db: Db, categoryId: number, month: string): Promise<void> {
  await db
    .delete(schema.budgets)
    .where(and(eq(schema.budgets.categoryId, categoryId), eq(schema.budgets.month, month)));
}

/** Set (or with null, remove) the optional overall budget for a month. */
export async function setTotalBudget(db: Db, month: string, amount: number | null): Promise<void> {
  assertMonth(month);
  if (amount === null) {
    await db.delete(schema.monthlyTotalBudget).where(eq(schema.monthlyTotalBudget.month, month));
    return;
  }
  assertCents(amount);
  await db
    .insert(schema.monthlyTotalBudget)
    .values({ month, amount })
    .onConflictDoUpdate({
      target: [schema.monthlyTotalBudget.userId, schema.monthlyTotalBudget.month],
      set: { amount },
    });
}

/** Copy all category budgets (and the total) from one month to another, overwriting. */
export async function copyBudgets(db: Db, fromMonth: string, toMonth: string): Promise<number> {
  assertMonth(fromMonth);
  assertMonth(toMonth);
  const rows = await db.select().from(schema.budgets).where(eq(schema.budgets.month, fromMonth));
  for (const r of rows) await setBudget(db, r.categoryId, toMonth, r.amount);
  const total = await first(
    db
      .select()
      .from(schema.monthlyTotalBudget)
      .where(eq(schema.monthlyTotalBudget.month, fromMonth)),
  );
  if (total) await setTotalBudget(db, toMonth, total.amount);
  return rows.length;
}

export interface MonthBudgets {
  /** Category id -> budget in cents, only for categories with a budget that month. */
  byCategory: Map<number, number>;
  /** The explicit monthly total, or null when none is set. */
  total: number | null;
}

/** Budgets for every month in fromMonth..toMonth (inclusive) that has any. Two queries. */
export async function getBudgetsByMonth(
  db: Db,
  fromMonth: string,
  toMonth: string,
): Promise<Map<string, MonthBudgets>> {
  assertMonth(fromMonth);
  assertMonth(toMonth);
  const out = new Map<string, MonthBudgets>();
  const at = (month: string) => {
    let b = out.get(month);
    if (!b) out.set(month, (b = { byCategory: new Map(), total: null }));
    return b;
  };
  for (const r of await db
    .select()
    .from(schema.budgets)
    .where(between(schema.budgets.month, fromMonth, toMonth)))
    at(r.month).byCategory.set(r.categoryId, r.amount);
  for (const r of await db
    .select()
    .from(schema.monthlyTotalBudget)
    .where(between(schema.monthlyTotalBudget.month, fromMonth, toMonth)))
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
