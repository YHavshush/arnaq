import { and, eq, gte, isNull, lt, type SQL } from "drizzle-orm";
import { daysInMonth } from "@/lib/recurring/dates";
import { schema, type Db } from "@/db";
import { addMonths } from "@/lib/recurring/dates";
import { assertMonth, getBudgetsByMonth, resolveTotalBudget } from "./budgets";
export interface CategoryLine {
  categoryId: number | null;
  name: string;
  /** Stable key of a default category (survives renaming); null for the user's own categories. */
  slug: string | null;
  type: "expense" | "income";
  budget: number | null; // cents
  actual: number; // cents, positive: money spent (expense) or received (income)
  remaining: number | null; // budget - actual for expenses, actual - budget for income
}

export interface MonthOverview {
  month: string;
  expenses: CategoryLine[];
  income: CategoryLine[];
  totals: {
    expenseActual: number;
    incomeActual: number;
    net: number;
    /** Explicit monthly total budget, else the sum of the category budgets (null if none set). */
    totalBudget: number | null;
    totalBudgetIsExplicit: boolean;
    totalRemaining: number | null;
  };
  /** Transactions in the month without a category (included in the totals, listed separately). */
  uncategorised: { expense: number; income: number; count: number };
  /** Rows in a foreign currency, left out of every number above. */
  foreignCurrencyCount: number;
  /** How many transactions the numbers above are made of. */
  transactionCount: number;
}

export interface MonthSums {
  /** Signed cents per category id (negative = money out, refunds count positive). */
  byCategory: Map<number, number>;
  /** Rows without a category, split by direction (positive cents each). */
  uncategorised: { expense: number; income: number; count: number };
  /** Rows in a foreign currency, left out of the sums. */
  foreignCurrencyCount: number;
  /** Rows the sums are made of. */
  counted: number;
}

export interface SumOptions {
  fromMonth: string;
  toMonth: string;
  /** Leave out transactions linked to a recurring occurrence (for variable spend). */
  excludeMatched?: boolean;
  /** Leave out these transaction ids as well. */
  excludeIds?: ReadonlySet<number>;
}

/**
 * The single place that decides which transactions count, shared by the month overview and
 * the forecast: by calendar month of the transaction date, internal transfers and rows not in
 * their account's currency left out, refunds netted against their category. One ranged query;
 * months without transactions are absent from the result.
 */
export async function sumTransactions(db: Db, opts: SumOptions): Promise<Map<string, MonthSums>> {
  assertMonth(opts.fromMonth);
  assertMonth(opts.toMonth);
  const t = schema.transactions;
  const where: SQL[] = [
    gte(t.date, `${opts.fromMonth}-01`),
    lt(t.date, `${addMonths(opts.toMonth, 1)}-01`),
    eq(t.isInternalTransfer, false),
  ];
  if (opts.excludeMatched) where.push(isNull(t.matchedOccurrenceId));
  const rows = await db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      currency: t.currency,
      categoryId: t.categoryId,
      accountCurrency: schema.accounts.currency,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(and(...where));

  const out = new Map<string, MonthSums>();
  for (const r of rows) {
    if (opts.excludeIds?.has(r.id)) continue;
    const month = r.date.slice(0, 7);
    let m = out.get(month);
    if (!m) {
      m = {
        byCategory: new Map(),
        uncategorised: { expense: 0, income: 0, count: 0 },
        foreignCurrencyCount: 0,
        counted: 0,
      };
      out.set(month, m);
    }
    if (r.currency !== r.accountCurrency) {
      m.foreignCurrencyCount++;
    } else if (r.categoryId === null) {
      m.counted++;
      m.uncategorised.count++;
      if (r.amount < 0) m.uncategorised.expense += -r.amount;
      else m.uncategorised.income += r.amount;
    } else {
      m.counted++;
      m.byCategory.set(r.categoryId, (m.byCategory.get(r.categoryId) ?? 0) + r.amount);
    }
  }
  return out;
}

/**
 * Budget vs actual for one calendar month (by transaction date), on the sumTransactions basis.
 */
export async function getMonthOverview(db: Db, month: string): Promise<MonthOverview> {
  assertMonth(month);

  const categories = await db.select().from(schema.categories).orderBy(schema.categories.sortOrder);
  const budget = (await getBudgetsByMonth(db, month, month)).get(month);
  const sums = (await sumTransactions(db, { fromMonth: month, toMonth: month })).get(month);
  const unc = sums?.uncategorised ?? { expense: 0, income: 0, count: 0 };

  const line = (c: (typeof categories)[number], type: "expense" | "income"): CategoryLine => {
    const raw = sums?.byCategory.get(c.id) ?? 0;
    const actual = type === "expense" ? 0 - raw : raw; // 0 - x avoids -0
    const b = budget?.byCategory.get(c.id) ?? null;
    return {
      categoryId: c.id,
      name: c.name,
      slug: c.slug,
      type,
      budget: b,
      actual,
      remaining: b === null ? null : type === "expense" ? b - actual : actual - b,
    };
  };

  const expenses = categories.filter((c) => c.type === "expense").map((c) => line(c, "expense"));
  const income = categories.filter((c) => c.type === "income").map((c) => line(c, "income"));

  const expenseActual = expenses.reduce((s, l) => s + l.actual, 0) + unc.expense;
  const incomeActual = income.reduce((s, l) => s + l.actual, 0) + unc.income;
  const explicitTotal = budget?.total ?? null;
  const totalBudget = resolveTotalBudget(
    explicitTotal,
    expenses.map((l) => l.budget),
  );

  return {
    month,
    expenses,
    income,
    totals: {
      expenseActual,
      incomeActual,
      net: incomeActual - expenseActual,
      totalBudget,
      totalBudgetIsExplicit: explicitTotal !== null,
      totalRemaining: totalBudget === null ? null : totalBudget - expenseActual,
    },
    uncategorised: { ...unc },
    foreignCurrencyCount: sums?.foreignCurrencyCount ?? 0,
    transactionCount: sums?.counted ?? 0,
  };
}

/**
 * Everyday spending per day of the month, in positive cents: money out that is not tied to a fixed
 * cost, internal transfers and foreign-currency rows left out (the same basis as the overview).
 * Index 0 is the 1st. Always as long as the month.
 */
export async function getDailySpend(db: Db, month: string): Promise<number[]> {
  assertMonth(month);
  const t = schema.transactions;
  const rows = await db
    .select({ date: t.date, amount: t.amount })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(
      and(
        gte(t.date, `${month}-01`),
        lt(t.date, `${addMonths(month, 1)}-01`),
        eq(t.isInternalTransfer, false),
        isNull(t.matchedOccurrenceId),
        eq(t.currency, schema.accounts.currency),
      ),
    );
  const days = new Array<number>(daysInMonth(month)).fill(0);
  for (const r of rows) {
    if (r.amount >= 0) continue;
    const day = Number(r.date.slice(8, 10)) - 1;
    if (day >= 0 && day < days.length) days[day] += -r.amount;
  }
  return days;
}

export interface IncomeLine {
  categoryId: number | null;
  /** Null: not categorised. */
  name: string | null;
  /** Positive cents received this month. */
  amount: number;
  /** Date of the latest of these payments. */
  lastDate: string;
}

/**
 * Money that came in this month and is not tied to a fixed income item (a gift, a refund, a one-off
 * job), grouped by category. Internal transfers and foreign-currency rows left out.
 */
export async function getOtherIncome(db: Db, month: string): Promise<IncomeLine[]> {
  assertMonth(month);
  const t = schema.transactions;
  const rows = await db
    .select({
      date: t.date,
      amount: t.amount,
      categoryId: t.categoryId,
      name: schema.categories.name,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .leftJoin(schema.categories, eq(schema.categories.id, t.categoryId))
    .where(
      and(
        gte(t.date, `${month}-01`),
        lt(t.date, `${addMonths(month, 1)}-01`),
        eq(t.isInternalTransfer, false),
        isNull(t.matchedOccurrenceId),
        eq(t.currency, schema.accounts.currency),
      ),
    );
  const byCategory = new Map<number | null, IncomeLine>();
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const line = byCategory.get(r.categoryId) ?? {
      categoryId: r.categoryId,
      name: r.name,
      amount: 0,
      lastDate: r.date,
    };
    line.amount += r.amount;
    if (r.date > line.lastDate) line.lastDate = r.date;
    byCategory.set(r.categoryId, line);
  }
  return [...byCategory.values()].sort((a, b) => b.amount - a.amount);
}
