import { and, eq, gte, isNull, lt, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addMonths } from "@/lib/recurring/dates";
import { assertMonth, getBudgetsByMonth, resolveTotalBudget } from "./budgets";
export interface CategoryLine {
  categoryId: number | null;
  name: string;
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
}

export interface MonthSums {
  /** Signed cents per category id (negative = money out, refunds count positive). */
  byCategory: Map<number, number>;
  /** Rows without a category, split by direction (positive cents each). */
  uncategorised: { expense: number; income: number; count: number };
  /** Rows in a foreign currency, left out of the sums. */
  foreignCurrencyCount: number;
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
      };
      out.set(month, m);
    }
    if (r.currency !== r.accountCurrency) {
      m.foreignCurrencyCount++;
    } else if (r.categoryId === null) {
      m.uncategorised.count++;
      if (r.amount < 0) m.uncategorised.expense += -r.amount;
      else m.uncategorised.income += r.amount;
    } else {
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
  };
}
