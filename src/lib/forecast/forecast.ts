import { asc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getBudgetsByMonth, resolveTotalBudget, type MonthBudgets } from "@/lib/budget/budgets";
import { getMonthOverview, sumTransactions, type MonthSums } from "@/lib/budget/overview";
import { addMonths, isDate, monthOf } from "@/lib/recurring/dates";
import { coveredMonths } from "@/lib/recurring/occurrences";
import { ForecastError } from "./errors";
import { countedAs, projectRecurring, type ForecastOccurrence } from "./recurring";
import { getVariableAverages, type VariableAverages } from "./variable";

export type { ForecastOccurrence } from "./recurring";

/** Accepted ranges and defaults for the options (also used by the API). */
export const FORECAST_LIMITS = {
  months: { min: 1, max: 36, default: 6 },
  history: { min: 1, max: 12, default: 3 },
  pastMonths: { min: 0, max: 12, default: 3 },
} as const;

export interface ForecastOptions {
  /** YYYY-MM-DD. The forecast never reads the clock. */
  today: string;
  /** Months ahead of the current month (1-36, default 6). */
  months?: number;
  /** Uploaded months before the current month to average variable spend over (1-12, default 3). */
  history?: number;
  /** Months before the current month to include as context for a chart (0-12, default 3). */
  pastMonths?: number;
}

/**
 * - actual: a past month with an upload; real numbers only (the month overview).
 * - no-data: a past month without an upload; unknown, so zero totals (and no budget difference).
 * - mixed: the current month; actual so far + still expected recurring + remaining variable.
 * - forecast: a future month; open recurring occurrences + average variable spend.
 */
export type MonthKind = "actual" | "no-data" | "mixed" | "forecast";

/** One expense category (or `categoryId: null` for uncategorised) in one month, cents. */
export interface ForecastCategory {
  categoryId: number | null;
  name: string;
  /** Real net spend in the month so far (actual and mixed months). */
  actual: number;
  /** Recurring payments still expected in this category (counted "projected"). */
  recurring: number;
  /** The variable-spend baseline (mixed and forecast months). */
  variableAverage: number;
  /** Variable spend still expected: the average (forecast) or what is left of it (mixed). */
  variable: number;
  total: number;
  budget: number | null;
  /** budget - total (positive: room left); null without a budget or without data. */
  difference: number | null;
}

export interface ForecastMonth {
  month: string;
  kind: MonthKind;
  /** Whether the month has at least one upload. */
  hasUpload: boolean;
  income: number;
  expenses: number;
  net: number;
  /** Running sum of `net` over the returned months up to and including this one. */
  cumulativeNet: number;
  /** The part of income and expenses that is real money already. */
  actual: { income: number; expenses: number };
  recurring: {
    /** Projected (not yet happened) recurring money counted in this month. */
    income: number;
    expenses: number;
    missedCount: number;
    occurrences: ForecastOccurrence[];
  };
  /** Projected variable spend counted in this month. */
  variable: number;
  categories: ForecastCategory[];
  budget: { total: number | null; isExplicit: boolean; difference: number | null };
}

export interface Forecast {
  today: string;
  currentMonth: string;
  settings: { months: number; history: number; pastMonths: number };
  variableBasis: {
    months: string[];
    history: number;
    lowConfidence: boolean;
    reason: string | null;
  };
  /** Missed occurrences within the returned months (the full list: /api/recurring/missed). */
  missed: ForecastOccurrence[];
  months: ForecastMonth[];
}

function readOptions(opts: ForecastOptions): Forecast["settings"] {
  if (!isDate(opts.today)) throw new ForecastError(`Invalid date "${opts.today}", use YYYY-MM-DD.`);
  const read = (name: keyof typeof FORECAST_LIMITS) => {
    const { min, max, default: fallback } = FORECAST_LIMITS[name];
    const value = opts[name] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max)
      throw new ForecastError(`${name} must be a whole number from ${min} to ${max}.`);
    return value;
  };
  return { months: read("months"), history: read("history"), pastMonths: read("pastMonths") };
}

interface Context {
  current: string;
  uploaded: Set<string>;
  categories: { id: number; name: string }[];
  averages: VariableAverages;
  budgets: Map<string, MonthBudgets>;
  occurrences: Map<string, Omit<ForecastOccurrence, "counted">[]>;
  inMemoryMatched: Set<number>;
}

/**
 * The prognose (PLAN.md core logic 7): per month from `pastMonths` before the current month
 * through `months` months after it. Read-only: nothing is generated, matched or stored; future
 * occurrences come from planOccurrences. A matched occurrence is real money in the actuals and
 * is never projected again (see projectRecurring and countedAs).
 */
export async function getForecast(db: Db, opts: ForecastOptions): Promise<Forecast> {
  const settings = readOptions(opts);
  const current = monthOf(opts.today);
  const first = addMonths(current, -settings.pastMonths);
  const last = addMonths(current, settings.months);
  const averages = await getVariableAverages(db, {
    beforeMonth: current,
    history: settings.history,
  });
  const { byMonth, inMemoryMatched } = await projectRecurring(db, { first, current, last });
  const ctx: Context = {
    current,
    uploaded: await coveredMonths(db),
    categories: await db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.type, "expense"))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    averages,
    budgets: await getBudgetsByMonth(db, first, last),
    occurrences: byMonth,
    inMemoryMatched,
  };

  let cumulativeNet = 0;
  const months: ForecastMonth[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    const month = await buildMonth(db, ctx, m);
    cumulativeNet += month.net;
    months.push({ ...month, cumulativeNet });
  }

  return {
    today: opts.today,
    currentMonth: current,
    settings,
    variableBasis: {
      months: averages.months,
      history: settings.history,
      lowConfidence: averages.lowConfidence,
      reason: averages.reason,
    },
    missed: months.flatMap((m) =>
      m.recurring.occurrences.filter((o) => o.status === "missed" && o.month === m.month),
    ),
    months,
  };
}

function kindOf(ctx: Context, month: string): MonthKind {
  if (month === ctx.current) return "mixed";
  if (month > ctx.current) return "forecast";
  return ctx.uploaded.has(month) ? "actual" : "no-data";
}

async function buildMonth(
  db: Db,
  ctx: Context,
  month: string,
): Promise<Omit<ForecastMonth, "cumulativeNet">> {
  const kind = kindOf(ctx, month);
  const occurrences: ForecastOccurrence[] = (ctx.occurrences.get(month) ?? []).map((o) => ({
    ...o,
    counted: countedAs(o, month, kind),
  }));
  const projected = occurrences.filter((o) => o.counted === "projected");
  const projectedIncome = projected.filter((o) => o.type === "income");
  const projectedExpenses = projected.filter((o) => o.type === "expense");

  const overview = kind === "actual" || kind === "mixed" ? await getMonthOverview(db, month) : null;
  const soFar =
    kind === "mixed"
      ? (
          await sumTransactions(db, {
            fromMonth: month,
            toMonth: month,
            excludeMatched: true,
            excludeIds: ctx.inMemoryMatched,
          })
        ).get(month)
      : undefined;

  const categories = categoryLines(ctx, month, kind, { overview, soFar, projectedExpenses });
  const actual = {
    income: overview?.totals.incomeActual ?? 0,
    expenses: overview?.totals.expenseActual ?? 0,
  };
  const sum = (xs: { amount: number }[]) => xs.reduce((s, o) => s + o.amount, 0);
  const income = actual.income + sum(projectedIncome);
  const expenses = categories.reduce((s, c) => s + c.total, 0);
  const b = ctx.budgets.get(month);
  const totalBudget = resolveTotalBudget(
    b?.total ?? null,
    categories.map((c) => c.budget),
  );

  return {
    month,
    kind,
    hasUpload: ctx.uploaded.has(month),
    income,
    expenses,
    net: income - expenses,
    actual,
    recurring: {
      income: sum(projectedIncome),
      expenses: sum(projectedExpenses),
      missedCount: occurrences.filter((o) => o.status === "missed" && o.month === month).length,
      occurrences,
    },
    variable: categories.reduce((s, c) => s + c.variable, 0),
    categories,
    budget: {
      total: totalBudget,
      isExplicit: (b?.total ?? null) !== null,
      difference: totalBudget === null || kind === "no-data" ? null : totalBudget - expenses,
    },
  };
}

function categoryLines(
  ctx: Context,
  month: string,
  kind: MonthKind,
  data: {
    overview: Awaited<ReturnType<typeof getMonthOverview>> | null;
    soFar: MonthSums | undefined;
    projectedExpenses: ForecastOccurrence[];
  },
): ForecastCategory[] {
  const known = new Set(ctx.categories.map((c) => c.id));
  const recurringBy = new Map<number | null, number>();
  for (const o of data.projectedExpenses) {
    const id = o.categoryId !== null && known.has(o.categoryId) ? o.categoryId : null;
    recurringBy.set(id, (recurringBy.get(id) ?? 0) + o.amount);
  }
  const actualBy = new Map<number | null, number>(
    (data.overview?.expenses ?? []).map((l) => [l.categoryId, l.actual]),
  );
  actualBy.set(null, data.overview?.uncategorised.expense ?? 0);
  const variableSoFar = (id: number | null) => {
    if (!data.soFar) return 0;
    if (id === null) return data.soFar.uncategorised.expense;
    return 0 - (data.soFar.byCategory.get(id) ?? 0);
  };
  const budgets = ctx.budgets.get(month)?.byCategory;

  const line = (id: number | null, name: string): ForecastCategory => {
    const projecting = kind === "mixed" || kind === "forecast";
    const average = !projecting
      ? 0
      : id === null
        ? ctx.averages.uncategorised
        : (ctx.averages.byCategory.get(id) ?? 0);
    // Remaining variable spend: what is left of the average after this month's variable spend
    // so far (net refunds never raise it above the average).
    const variable =
      kind === "mixed" ? Math.max(0, average - Math.max(0, variableSoFar(id))) : average;
    const actual = actualBy.get(id) ?? 0;
    const recurring = recurringBy.get(id) ?? 0;
    const total = actual + recurring + variable;
    const budget = id === null ? null : (budgets?.get(id) ?? null);
    return {
      categoryId: id,
      name,
      actual,
      recurring,
      variableAverage: average,
      variable,
      total,
      budget,
      difference: budget === null || kind === "no-data" ? null : budget - total,
    };
  };
  return [...ctx.categories.map((c) => line(c.id, c.name)), line(null, "Uncategorised")];
}
