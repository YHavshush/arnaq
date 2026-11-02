import { and, between, eq, lte, or } from "drizzle-orm";
import { first, schema, type Db } from "@/db";
import { MAX_CENTS } from "@/lib/money";
import { addMonths } from "@/lib/recurring/dates";
import { isScheduled } from "@/lib/recurring/occurrences";
import { btwShareForMonth } from "@/lib/btw/share";
import { TAXES_CATEGORY } from "@/lib/categories/defaults";

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
  /**
   * Category id -> budget in cents, only for categories with a budget that month: what the person typed, but never
   * less than the category's fixed items (`max(explicit, fixed)`). Nothing typed means the fixed items are the budget.
   * With the `btw` option the taxes category's floor is its fixed items plus the month's BTW share.
   */
  byCategory: Map<number, number>;
  /** The fixed (recurring) expense items of the category scheduled that month, in cents. */
  fixed: Map<number, number>;
  /** What the person typed as a budget for the category (with `carryForwardFrom`: or the carried amount). */
  explicit: Map<number, number>;
  /** With `carryForwardFrom`: categories whose `explicit` amount was carried from an earlier month, and that month. */
  carriedFrom: Map<number, string>;
  /** With `btw`: the taxes category's BTW share for the month (see btwShareForMonth), cents; empty otherwise. */
  btw: Map<number, number>;
  /** The explicit monthly total, or null when none is set. */
  total: number | null;
}

export interface BudgetOptions {
  /**
   * From this month (YYYY-MM) on, a category without a typed budget uses the most recent earlier month's typed budget,
   * until a new one is typed. The fixed items of each month stay its floor. The monthly total is not carried. Off by
   * default: the budget screens show only what was typed for the month.
   */
  carryForwardFrom?: string;
  /**
   * Add the BTW to set aside for each month (btwShareForMonth, `today` decides what is received and what expected) to
   * the taxes category's floor: `max(typed, fixed items + BTW share)`. Off by default; the forecast never uses it, so
   * nothing is counted twice there.
   */
  btw?: { today: string };
}

/** Budgets for every month in fromMonth..toMonth (inclusive) that has any. */
export async function getBudgetsByMonth(
  db: Db,
  fromMonth: string,
  toMonth: string,
  opts: BudgetOptions = {},
): Promise<Map<string, MonthBudgets>> {
  assertMonth(fromMonth);
  assertMonth(toMonth);
  if (opts.carryForwardFrom !== undefined) assertMonth(opts.carryForwardFrom);
  const out = new Map<string, MonthBudgets>();
  const at = (month: string) => {
    let b = out.get(month);
    if (!b)
      out.set(
        month,
        (b = {
          byCategory: new Map(),
          fixed: new Map(),
          explicit: new Map(),
          carriedFrom: new Map(),
          btw: new Map(),
          total: null,
        }),
      );
    return b;
  };
  const carryFrom = opts.carryForwardFrom;
  // Carrying forward needs the typed budgets of earlier months too (even from before fromMonth).
  const typed = await db
    .select()
    .from(schema.budgets)
    .where(
      carryFrom !== undefined && carryFrom <= toMonth
        ? lte(schema.budgets.month, toMonth)
        : between(schema.budgets.month, fromMonth, toMonth),
    );
  for (const r of typed)
    if (r.month >= fromMonth && r.month <= toMonth)
      at(r.month).explicit.set(r.categoryId, r.amount);
  for (const r of await db
    .select()
    .from(schema.monthlyTotalBudget)
    .where(between(schema.monthlyTotalBudget.month, fromMonth, toMonth)))
    at(r.month).total = r.amount;

  if (carryFrom !== undefined && carryFrom <= toMonth) {
    const start = carryFrom > fromMonth ? carryFrom : fromMonth;
    // The most recent typed budget of each category before the month being filled: category -> [month, amount].
    const latest = new Map<number, [string, number]>();
    const byMonth = new Map<string, typeof typed>();
    for (const r of [...typed].sort((a, b) => a.month.localeCompare(b.month))) {
      if (r.month < start) latest.set(r.categoryId, [r.month, r.amount]);
      else byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
    }
    for (let m = start; m <= toMonth; m = addMonths(m, 1)) {
      for (const [id, [from, amount]] of latest)
        if (!(out.get(m)?.explicit.has(id) ?? false)) {
          at(m).explicit.set(id, amount);
          at(m).carriedFrom.set(id, from);
        }
      for (const r of byMonth.get(m) ?? []) latest.set(r.categoryId, [r.month, r.amount]);
    }
  }

  // What recurs is planned: an active outgoing item in an expense category is that category's budget, so rent,
  // insurance, phone and subscriptions need no separate budget. Savings deposits and income are not budgets.
  const items = await db
    .select({
      categoryId: schema.recurringItems.categoryId,
      expectedAmount: schema.recurringItems.expectedAmount,
      dayOfMonth: schema.recurringItems.dayOfMonth,
      frequency: schema.recurringItems.frequency,
      startDate: schema.recurringItems.startDate,
      endDate: schema.recurringItems.endDate,
    })
    .from(schema.recurringItems)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.recurringItems.categoryId))
    .where(
      and(
        eq(schema.recurringItems.active, true),
        eq(schema.recurringItems.type, "expense"),
        eq(schema.categories.type, "expense"),
      ),
    );
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1))
    for (const item of items)
      if (item.categoryId !== null && isScheduled(item, m)) {
        const fixed = at(m).fixed;
        fixed.set(item.categoryId, (fixed.get(item.categoryId) ?? 0) + item.expectedAmount);
      }

  // The BTW to set aside works like rent for the taxes category: a fixed amount for the month, on top of its fixed items.
  if (opts.btw) {
    const taxes = await taxesCategoryId(db);
    if (taxes !== null)
      for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) {
        const { share } = await btwShareForMonth(db, { month: m, today: opts.btw.today });
        if (share > 0) at(m).btw.set(taxes, share);
      }
  }

  for (const b of out.values()) {
    for (const [id, amount] of b.explicit) b.byCategory.set(id, amount);
    // The fixed items are the floor: a typed rent budget that already includes the rent is not counted twice.
    for (const [id, amount] of b.fixed)
      b.byCategory.set(id, Math.max(b.byCategory.get(id) ?? 0, amount));
    for (const [id, share] of b.btw)
      b.byCategory.set(id, Math.max(b.byCategory.get(id) ?? 0, (b.fixed.get(id) ?? 0) + share));
  }
  return out;
}

/** The taxes category: the default one by its stable slug, else by its default name; null when the person has none. */
async function taxesCategoryId(db: Db): Promise<number | null> {
  const rows = await db
    .select({ id: schema.categories.id, slug: schema.categories.slug })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.type, "expense"),
        or(eq(schema.categories.slug, "taxes"), eq(schema.categories.name, TAXES_CATEGORY)),
      ),
    );
  return (rows.find((r) => r.slug === "taxes") ?? rows[0])?.id ?? null;
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
