import { and, eq, like } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { assertMonth } from "./budgets";

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

/**
 * Budget vs actual for one calendar month (by transaction date).
 * Internal transfers and non-account-currency rows are excluded. Refunds on an expense
 * category reduce its actual.
 */
export function getMonthOverview(db: Db, month: string): MonthOverview {
  assertMonth(month);

  const categories = db.select().from(schema.categories).orderBy(schema.categories.sortOrder).all();
  const budgets = new Map(
    db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.month, month))
      .all()
      .map((b) => [b.categoryId, b.amount]),
  );
  const explicitTotal = db
    .select()
    .from(schema.monthlyTotalBudget)
    .where(eq(schema.monthlyTotalBudget.month, month))
    .get();

  const txs = db
    .select({ t: schema.transactions, accountCurrency: schema.accounts.currency })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        like(schema.transactions.date, `${month}-%`),
        eq(schema.transactions.isInternalTransfer, false),
      ),
    )
    .all();

  const sums = new Map<number, number>();
  const unc = { expense: 0, income: 0, count: 0 };
  let foreign = 0;
  for (const { t, accountCurrency } of txs) {
    if (t.currency !== accountCurrency) {
      foreign++;
      continue;
    }
    if (t.categoryId === null) {
      unc.count++;
      if (t.amount < 0) unc.expense += -t.amount;
      else unc.income += t.amount;
    } else {
      sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount);
    }
  }

  const line = (c: (typeof categories)[number], type: "expense" | "income"): CategoryLine => {
    const raw = sums.get(c.id) ?? 0;
    const actual = type === "expense" ? 0 - raw : raw; // 0 - x avoids -0
    const budget = budgets.get(c.id) ?? null;
    return {
      categoryId: c.id,
      name: c.name,
      type,
      budget,
      actual,
      remaining: budget === null ? null : type === "expense" ? budget - actual : actual - budget,
    };
  };

  const expenses = categories.filter((c) => c.type === "expense").map((c) => line(c, "expense"));
  const income = categories.filter((c) => c.type === "income").map((c) => line(c, "income"));

  const expenseActual = expenses.reduce((s, l) => s + l.actual, 0) + unc.expense;
  const incomeActual = income.reduce((s, l) => s + l.actual, 0) + unc.income;
  const categoryBudgetSum = expenses.reduce((s, l) => s + (l.budget ?? 0), 0);
  const anyBudget = expenses.some((l) => l.budget !== null);
  const totalBudget = explicitTotal ? explicitTotal.amount : anyBudget ? categoryBudgetSum : null;

  return {
    month,
    expenses,
    income,
    totals: {
      expenseActual,
      incomeActual,
      net: incomeActual - expenseActual,
      totalBudget,
      totalBudgetIsExplicit: !!explicitTotal,
      totalRemaining: totalBudget === null ? null : totalBudget - expenseActual,
    },
    uncategorised: unc,
    foreignCurrencyCount: foreign,
  };
}
