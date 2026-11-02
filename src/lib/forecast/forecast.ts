import { getDailyBalances, getOpeningBalance } from "./balance";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getBudgetsByMonth, resolveTotalBudget, type MonthBudgets } from "@/lib/budget/budgets";
import { getMonthOverview, sumTransactions, type MonthSums } from "@/lib/budget/overview";
import { addMonths, daysInMonth, isDate, monthOf } from "@/lib/recurring/dates";
import { coveredMonths } from "@/lib/recurring/occurrences";
import { savingsCategoryIds } from "@/lib/recurring/matching";
import { getBtwSettings } from "@/lib/btw/settings";
import { clientItemIds } from "@/lib/btw/share";
import { btwInside, btwNetWorth, getBtwSummary, mentions } from "@/lib/btw/summary";
import { getPlanOverrides, indexOverrides, overrideKey } from "@/lib/plan/overrides";
import { getSavingsSummary } from "@/lib/savings/summary";
import { ForecastError } from "./errors";
import { lowestDay, simulateDays, type MonthLow } from "./low";
import { scaleAverages } from "./own";
import { countedAs, projectRecurring, type ForecastOccurrence } from "./recurring";
import { getVariableAverages, type VariableAverages } from "./variable";

export type { ForecastOccurrence } from "./recurring";
export type { MonthLow } from "./low";

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
  /**
   * What the coming months' everyday spending is based on: "averages" (what was spent in the last months, the
   * default) or "budget" (the budget of each category that has one, less its fixed items; the average for the rest).
   */
  basis?: "averages" | "budget" | "own";
  /** The monthly everyday spending the person typed (cents); used with basis "own", ignored without it. */
  ownSpending?: number | null;
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
  /**
   * What the month's still expected expenses are made of, cents (all 0 and `fellBack` empty for actual and no-data
   * months):
   * - fixed: the fixed (recurring) expense items still expected (`recurring.expenses`; savings deposits are not in it);
   * - budgets: everyday spending that comes from a budget (typed for the month, carried from an earlier month, or the
   *   category's fixed items as its budget), less the fixed items in it; only with basis "budget";
   * - averages: everyday spending that comes from the averages (with basis "own": the typed amount shared out like
   *   them), uncategorised included;
   * - typed: everyday spending of the categories the person typed an amount for in the plan (plan_overrides), whatever
   *   the basis; those categories are in neither budgets nor averages;
   * - fellBack: with basis "budget", the categories that use their average because no budget exists for them even
   *   after carrying forward (only those whose average is above 0, never a typed one; uncategorised is never named).
   * For a forecast month `fixed + budgets + averages + typed === expenses`. For the current month what is already spent
   * is real money and not a source: `actual.expenses + fixed + budgets + averages + typed === expenses`, and budgets,
   * averages and typed are what is left of them after this month's everyday spending so far (never below 0).
   */
  expenseSources: {
    fixed: number;
    budgets: number;
    averages: number;
    typed: number;
    fellBack: string[];
  };
  /**
   * The BTW that builds up on the client's income expected in this month (cents): round(21/121 x the client's fixed
   * income items still expected in it). 0 for actual and no-data months: real income is in the BTW now. Not in
   * `expenses` or `net` (those stay cash); it only lowers the net worth line.
   */
  btwAccrued: number;
  /**
   * The BTW part of net worth at the end of this month (cents): the BTW now (`Forecast.btwNow`), plus what fixed items
   * still move into the BTW pocket up to this month (the person's own money moving between accounts), minus the BTW
   * accrued up to this month. Real months carry the BTW now unchanged.
   */
  btwWorth: number;
  /**
   * The lowest end-of-day balance of the checking accounts (all accounts together; savings are not an account) in
   * this month, and the day. Real days come from the bank's stated balances; the days from today on are simulated
   * (see monthDays). Null when no balance is known, or for a past month without data.
   */
  low: MonthLow | null;
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
  /**
   * The BTW in net worth now (cents): the pocket minus what is still owed for the card's quarter, as on the net worth
   * card (btwNetWorth). 0 without BTW data.
   */
  btwNow: number;
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
  /** Months that have at least one transaction: what is in is real, even when the statements stop before the month ends. */
  withData: Set<string>;
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
  basis: "averages" | "budget";
  /** The client's fixed income items: what they bring in carries BTW. */
  clientItems: Set<number>;
  /** Everyday spending typed in the plan per category and month (overrideKey -> cents), from the current month on. */
  typedCategories: Map<string, number>;
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
  const measured = await getVariableAverages(db, {
    beforeMonth: current,
    history: settings.history,
  });
  const own = opts.basis === "own" ? (opts.ownSpending ?? null) : null;
  const averages = own === null ? measured : scaleAverages(measured, own);
  const { byMonth, inMemoryMatched } = await projectRecurring(db, { first, current, last });
  const { pocket, client } = await getBtwSettings(db);
  const basis = opts.basis === "budget" ? "budget" : "averages";
  const ctx: Context = {
    current,
    uploaded: await coveredMonths(db),
    withData: await monthsWithTransactions(db, first, last),
    categories: await db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.type, "expense"))
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    averages,
    // With the budget basis a typed budget holds until a new one is typed (from the current month on). Never with the
    // BTW share: the forecast accrues the BTW on the net worth line instead, so it is not counted twice.
    budgets: await getBudgetsByMonth(
      db,
      first,
      last,
      basis === "budget" ? { carryForwardFrom: current } : {},
    ),
    occurrences: byMonth,
    inMemoryMatched,
    savings: await savingsCategoryIds(db),
    pocket,
    basis,
    clientItems: await clientItemIds(db, client),
    movedToSavings: await getMovedToSavings(db, first, last, pocket),
    typedCategories: indexOverrides(await getPlanOverrides(db, { from: current, to: last }))
      .categories,
  };

  // The checking balance at the end of each real day, from the first month shown through today.
  const real = await getDailyBalances(db, `${first}-01`, opts.today);
  let cumulativeNet = 0;
  let cumulativeSetAside = 0;
  let cumulativeReserve = 0;
  let end: number | null = null;
  const btwNow = btwNetWorth(await getBtwSummary(db, { today: opts.today }));
  let btwWorth = btwNow;
  const months: ForecastMonth[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    const { plannedReserve, ...month } = await buildMonth(db, ctx, m);
    cumulativeNet += month.net;
    cumulativeSetAside += month.setAside.total;
    cumulativeReserve += month.setAside.reserve;
    // A planned move into the pocket leaves the accounts but stays the person's money; the BTW accrued is owed.
    btwWorth += plannedReserve - month.btwAccrued;
    const days = monthDays(month, real, opts.today, end);
    end = days?.at(-1) ?? null;
    const low = days ? lowestDay(m, 1, days) : null;
    months.push({
      ...month,
      cumulativeNet,
      cumulativeSetAside,
      cumulativeReserve,
      btwWorth,
      low,
    });
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
    btwNow,
  };
}

/**
 * The month's end-of-day checking balances (index 0 is the 1st), or null when they cannot be known honestly.
 *
 * - actual: the real balances from the statements, day by day (a day after an account's last statement keeps
 *   its last balance).
 * - no-data: null; nothing is known about what happened in it.
 * - mixed: the real balances up to yesterday; from today on, starting from today's real balance, the fixed items
 *   still expected (on their day, or today when their day has passed) and the everyday spending still expected,
 *   spread evenly over the days left, today included.
 * - forecast: starts where the month before ended (`previousEnd`), the open fixed items on their day and the
 *   month's everyday spending spread evenly over all its days.
 *
 * Fixed items include planned deposits into savings: that money leaves the checking accounts. So a simulated month
 * ends on its start plus `net` less `setAside.total`, the same step as the chart's accounts line.
 */
function monthDays(
  month: Pick<ForecastMonth, "month" | "kind" | "variable" | "recurring">,
  real: Map<string, number> | null,
  today: string,
  previousEnd: number | null,
): number[] | null {
  if (real === null || month.kind === "no-data") return null;
  const realDays = (count: number) => {
    const out: number[] = [];
    for (let day = 1; day <= count; day++) {
      const balance = real.get(`${month.month}-${String(day).padStart(2, "0")}`);
      if (balance === undefined) return null;
      out.push(balance);
    }
    return out;
  };
  if (month.kind === "actual") return realDays(daysInMonth(month.month));

  const moves = month.recurring.occurrences
    .filter((o) => o.counted === "projected")
    .map((o) => ({ type: o.type, amount: o.amount, date: o.expectedDate, name: o.name }));
  if (month.kind === "forecast")
    return previousEnd === null
      ? null
      : simulateDays({ month: month.month, start: previousEnd, moves, variable: month.variable });

  // The current month: what really happened so far, then the rest from today's real balance.
  const day = Number(today.slice(8, 10));
  const before = realDays(day - 1);
  const now = real.get(today);
  if (before === null || now === undefined) return null;
  return [
    ...before,
    ...simulateDays({
      month: month.month,
      start: now,
      fromDay: day,
      moves,
      variable: month.variable,
    }),
  ];
}

/** The months from `first` to `last` that hold at least one transaction in the account's own currency. */
async function monthsWithTransactions(db: Db, first: string, last: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ month: sql<string>`substr(${schema.transactions.date}, 1, 7)` })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        eq(schema.transactions.currency, schema.accounts.currency),
        gte(schema.transactions.date, `${first}-01`),
        lte(schema.transactions.date, `${last}-31`),
      ),
    );
  return new Set(rows.map((r) => r.month));
}

function kindOf(ctx: Context, month: string): MonthKind {
  if (month === ctx.current) return "mixed";
  if (month > ctx.current) return "forecast";
  return ctx.uploaded.has(month) || ctx.withData.has(month) ? "actual" : "no-data";
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
): Promise<
  Omit<
    ForecastMonth,
    "cumulativeNet" | "cumulativeSetAside" | "cumulativeReserve" | "btwWorth" | "low"
  > & { plannedReserve: number }
> {
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
  const projecting = kind === "mixed" || kind === "forecast";
  const clientIncome = sum(projectedIncome.filter((o) => ctx.clientItems.has(o.recurringItemId)));

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
    expenseSources: projecting
      ? expenseSources(ctx, month, categories, sum(projectedExpenses))
      : { fixed: 0, budgets: 0, averages: 0, typed: 0, fellBack: [] },
    btwAccrued: projecting ? btwInside(clientIncome) : 0,
    plannedReserve,
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
    const budgeted =
      ctx.basis === "budget" && projecting && id !== null ? (budgets?.get(id) ?? null) : null;
    const typed = projecting && id !== null ? typedFor(ctx, id, month) : null;
    const average = !projecting
      ? 0
      : typed !== null
        ? typed
        : budgeted !== null
          ? Math.max(0, budgeted - (recurringBy.get(id) ?? 0))
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

/**
 * Where a projected month's expected expenses come from (see ForecastMonth.expenseSources). A category's everyday
 * spending comes from its budget exactly when categoryLines used one: basis "budget" and a budget for the month (typed,
 * carried forward, or its fixed items).
 */
function expenseSources(
  ctx: Context,
  month: string,
  categories: ForecastCategory[],
  fixed: number,
): ForecastMonth["expenseSources"] {
  const budgets = ctx.budgets.get(month)?.byCategory;
  const fromBudget = (c: ForecastCategory) =>
    ctx.basis === "budget" && c.categoryId !== null && budgets?.has(c.categoryId) === true;
  let fromBudgets = 0;
  let fromAverages = 0;
  let fromTyped = 0;
  const fellBack: string[] = [];
  for (const c of categories) {
    if (c.categoryId !== null && typedFor(ctx, c.categoryId, month) !== null)
      fromTyped += c.variable;
    else if (fromBudget(c)) fromBudgets += c.variable;
    else {
      fromAverages += c.variable;
      if (ctx.basis === "budget" && c.categoryId !== null && c.variableAverage > 0)
        fellBack.push(c.name);
    }
  }
  return { fixed, budgets: fromBudgets, averages: fromAverages, typed: fromTyped, fellBack };
}

/** What the person typed in the plan as a category's everyday spending for a month still to come, or null. */
function typedFor(ctx: Context, categoryId: number, month: string): number | null {
  if (month < ctx.current) return null;
  return ctx.typedCategories.get(overrideKey(categoryId, month)) ?? null;
}
