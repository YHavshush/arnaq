import { getOpeningBalance } from "./balance";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getBudgetsByMonth, resolveTotalBudget, type MonthBudgets } from "@/lib/budget/budgets";
import { getMonthOverview, sumTransactions, type MonthSums } from "@/lib/budget/overview";
import { addMonths, isDate, monthOf } from "@/lib/recurring/dates";
import { coveredMonths } from "@/lib/recurring/occurrences";
import { savingsCategoryIds } from "@/lib/recurring/matching";
import { getBtwSettings } from "@/lib/btw/settings";
import { mentions } from "@/lib/btw/summary";
import { getSavingsSummary } from "@/lib/savings/summary";
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

/** One recurring item as it counts in a month's totals: what the money is, and whether it has happened. */
export interface ForecastPart {
  name: string;
  /** Positive cents: the real amount when already paid or received, otherwise the expected amount. */
  amount: number;
  /** The item's expense category (null: none or unknown); lets everyday spending be told apart from fixed costs. */
  categoryId: number | null;
  /** The money has really moved (matched to a payment in this month); false: still expected. */
  settled: boolean;
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
  /**
   * Money moved into savings (net of what came back out), cents. Neither income nor spending, so it is
   * not in `net`, but it has left the current account: `actual` is what really moved, `planned` what fixed
   * items still put aside this month or later. `reserve` is the part of `total` set aside for the BTW: that money
   * is owed, so it does not count as savings.
   */
  setAside: { actual: number; planned: number; total: number; reserve: number };
  /** Running sum of `setAside.total` over the returned months up to and including this one. */
  cumulativeSetAside: number;
  /** Running sum of `setAside.reserve`: the part set aside for the BTW, which is owed and not savings. */
  cumulativeReserve: number;
  /** The part of income and expenses that is real money already. */
  actual: { income: number; expenses: number };
  recurring: {
    /** Projected (not yet happened) recurring money counted in this month. */
    income: number;
    expenses: number;
    missedCount: number;
    occurrences: ForecastOccurrence[];
  };
  /**
   * The recurring items inside `income` and `expenses`, one line each (savings deposits are not spending and
   * are left out). The month's other money is whatever the totals have beyond these lines.
   */
  parts: { income: ForecastPart[]; fixed: ForecastPart[] };
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
  /** What the person had at the start of the first month shown, from the bank's own balances; null when unknown. */
  openingBalance: number | null;
  /** What was saved at the start of the first month shown (cents); null when no savings are known. */
  openingSavings: number | null;
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
  /** Categories that put money aside; a fixed item in one of them is a deposit, not spending. */
  savings: Set<number>;
  /** Net money that really moved into savings, per month, and the part of it that went to the BTW pocket. */
  movedToSavings: Map<string, { total: number; reserve: number }>;
  /** The word that marks a move or a planned deposit as BTW money. */
  pocket: string;
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
  const { pocket } = await getBtwSettings(db);
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
    savings: await savingsCategoryIds(db),
    pocket,
    movedToSavings: await getMovedToSavings(db, first, last, pocket),
  };

  let cumulativeNet = 0;
  let cumulativeSetAside = 0;
  let cumulativeReserve = 0;
  const months: ForecastMonth[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    const month = await buildMonth(db, ctx, m);
    cumulativeNet += month.net;
    cumulativeSetAside += month.setAside.total;
    cumulativeReserve += month.setAside.reserve;
    months.push({ ...month, cumulativeNet, cumulativeSetAside, cumulativeReserve });
  }

  // Savings now, minus what moved in since the first month began, is what was saved when the chart starts.
  const savingsNow = await getSavingsSummary(db, { today: opts.today });
  const savingsKnown = savingsNow.anchored || savingsNow.start > 0 || savingsNow.lines > 0;
  // Only real savings count: what went to the BTW pocket is owed, not saved. Only months up to now have real moves.
  const movedSince = [...ctx.movedToSavings]
    .filter(([month]) => month <= current)
    .reduce((sum, [, m]) => sum + m.total - m.reserve, 0);

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
    openingBalance: await getOpeningBalance(db, first),
    openingSavings: savingsKnown ? savingsNow.saved - movedSince : null,
  };
}

function kindOf(ctx: Context, month: string): MonthKind {
  if (month === ctx.current) return "mixed";
  if (month > ctx.current) return "forecast";
  return ctx.uploaded.has(month) ? "actual" : "no-data";
}

/** Per month (YYYY-MM): deposits minus withdrawals on the savings category, in each account's own currency. */
async function getMovedToSavings(db: Db, first: string, last: string, pocket: string) {
  const rows = await db
    .select({
      date: schema.transactions.date,
      amount: schema.transactions.amount,
      counterparty: schema.transactions.counterparty,
      description: schema.transactions.description,
    })
    .from(schema.transactions)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        eq(schema.categories.type, "savings"),
        eq(schema.transactions.currency, schema.accounts.currency),
        gte(schema.transactions.date, `${first}-01`),
        lte(schema.transactions.date, `${last}-31`),
      ),
    );
  const byMonth = new Map<string, { total: number; reserve: number }>();
  for (const r of rows) {
    const entry = byMonth.get(r.date.slice(0, 7)) ?? { total: 0, reserve: 0 };
    entry.total -= r.amount;
    if (mentions([r.counterparty, r.description], pocket)) entry.reserve -= r.amount;
    byMonth.set(r.date.slice(0, 7), entry);
  }
  return byMonth;
}

async function buildMonth(
  db: Db,
  ctx: Context,
  month: string,
): Promise<Omit<ForecastMonth, "cumulativeNet" | "cumulativeSetAside" | "cumulativeReserve">> {
  const kind = kindOf(ctx, month);
  const occurrences: ForecastOccurrence[] = (ctx.occurrences.get(month) ?? []).map((o) => ({
    ...o,
    counted: countedAs(o, month, kind),
  }));
  const projected = occurrences.filter((o) => o.counted === "projected");
  const isDeposit = (o: ForecastOccurrence) =>
    o.categoryId !== null && ctx.savings.has(o.categoryId);
  const projectedIncome = projected.filter((o) => o.type === "income");
  const projectedExpenses = projected.filter((o) => o.type === "expense" && !isDeposit(o));
  const projectedDeposits = projected.filter((o) => o.type === "expense" && isDeposit(o));

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

  const moved = kind === "actual" || kind === "mixed" ? ctx.movedToSavings.get(month) : undefined;
  const setAsideActual = moved?.total ?? 0;
  const setAsidePlanned = sum(projectedDeposits);
  // A planned deposit named for the BTW is the reserve: owed money, not savings.
  const plannedReserve = sum(projectedDeposits.filter((o) => mentions([o.name], ctx.pocket)));

  const known = new Set(ctx.categories.map((c) => c.id));
  const part = (o: ForecastOccurrence): ForecastPart => ({
    name: o.name,
    amount: o.amount,
    categoryId: o.categoryId !== null && known.has(o.categoryId) ? o.categoryId : null,
    settled: o.counted === "actual",
  });
  const counts = occurrences.filter((o) => o.counted !== "none");

  return {
    month,
    kind,
    hasUpload: ctx.uploaded.has(month),
    income,
    expenses,
    net: income - expenses,
    setAside: {
      actual: setAsideActual,
      planned: setAsidePlanned,
      total: setAsideActual + setAsidePlanned,
      reserve: (moved?.reserve ?? 0) + plannedReserve,
    },
    actual,
    recurring: {
      income: sum(projectedIncome),
      expenses: sum(projectedExpenses),
      missedCount: occurrences.filter((o) => o.status === "missed" && o.month === month).length,
      occurrences,
    },
    parts: {
      income: counts.filter((o) => o.type === "income").map(part),
      fixed: counts.filter((o) => o.type === "expense" && !isDeposit(o)).map(part),
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
