import { schema, type Db } from "@/db";
import { btwShareForMonth } from "@/lib/btw/share";
import { getBudgetsByMonth } from "@/lib/budget/budgets";
import { getForecast, type ForecastMonth } from "@/lib/forecast/forecast";
import { getOwnSpending } from "@/lib/forecast/own";
import {
  PLAN_HORIZON_MONTHS,
  PlanError,
  getPlanOverrides,
  indexOverrides,
  overrideKey,
} from "@/lib/plan/overrides";
import { savingsCategoryIds } from "@/lib/recurring/matching";
import { addMonths, monthOf } from "@/lib/recurring/dates";
import { buildPrognose } from "./prognose";

export type PlanBasis = "averages" | "budget" | "own";

/**
 * Where a suggestion comes from, for "tap a cell, see why":
 * - average: the category's average over these uploaded months;
 * - own: the person's own monthly amount ("My own" basis), shared out like the averages;
 * - budget: the budget typed for this month (`from` is the month);
 * - carried: a budget typed for an earlier month (`from`), carried forward;
 * - fixed: the Fixed page (a fixed item's own amount; for a category, a budget that is only its fixed items).
 */
export type PlanWhy =
  | { type: "average"; months: string[] }
  | { type: "own" }
  | { type: "budget"; from: string }
  | { type: "carried"; from: string }
  | { type: "fixed" };

export interface PlanCell {
  month: string;
  /** What the forecast counts for this row and month (cents): the typed amount, or the suggestion. */
  amount: number;
  /**
   * - typed: the person typed an amount for this cell (`typed`);
   * - suggestion: a category's everyday spending as the basis suggests it;
   * - item: a fixed item's own amount (the Fixed page);
   * - computed: follows other numbers and is never typed (the BTW, "everything else", other income).
   */
  source: "typed" | "suggestion" | "computed" | "item";
  /** What the cell would be without anything typed (cents). Equals `amount` when nothing is typed. */
  suggestion: number;
  why: PlanWhy | null;
  /** A typed fixed item amount equal to the item's own amount on the Fixed page: the screen can offer a reset. */
  redundant: boolean;
  /** The screen may let the person type here (PUT /api/plan accepts it). */
  editable: boolean;
  /**
   * What was typed for this cell (cents), or null. For the current month `amount` can differ from it: a category's
   * spending so far is real (it can go over), and a fixed item already paid keeps its real amount.
   */
  typed: number | null;
}

export interface PlanRow {
  /** `category-<id>`, `item-<id>`, `btw`, `other` (everything else), `uncategorised` or `income-other`. */
  key: string;
  /** The person's own name for a category or fixed item; null for a row the app makes up (labelled by key). */
  name: string | null;
  /**
   * category and item rows can be typed (cells with `editable`); btw is computed from the client's income; other is a
   * sum (everything else, uncategorised, or real income that is not a fixed item).
   */
  kind: "category" | "item" | "btw" | "other";
  /** The category or item id; null for btw and other rows. */
  id: number | null;
  cells: PlanCell[];
}

export interface PlanFooter {
  month: string;
  /** The Ahead chart's own numbers for the month (cents). */
  income: number;
  expenses: number;
  /** income - expenses: cash, like the forecast (the BTW is not in it). */
  growth: number;
  /** Net worth at the end of the month: the Ahead line. */
  netWorth: number;
  /** The month's lowest end-of-day checking balance, as the forecast simulates it; null when unknown. */
  low: { amount: number; date: string } | null;
}

export interface Plan {
  currentMonth: string;
  /** The current month and the months ahead shown, YYYY-MM. */
  months: string[];
  basis: PlanBasis;
  /** How far ahead a cell can be typed (months after the current month); "this and the months after" fills to there. */
  horizon: number;
  /**
   * The grid. income + fixed + variable rows add up to the footer's income and expenses in every month. The btw row is
   * information: the BTW building up on the client's income, owed, not in expenses (it lowers net worth).
   * variable holds the categories shown by default (any with something typed in the months shown, and the five with
   * the most expected spending, biggest first) and one `other` row with everything else.
   */
  sections: { income: PlanRow[]; fixed: PlanRow[]; btw: PlanRow[]; variable: PlanRow[] };
  /** Every expense category (and uncategorised spending when there is any), for "show all categories". */
  allCategories: PlanRow[];
  footer: PlanFooter[];
}

/** How many categories are shown by default besides the typed ones. */
const BIGGEST = 5;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * The plan grid for the current month and `months` months after it (1 to PLAN_HORIZON_MONTHS). Built from getForecast
 * with the same options as the Ahead chart (one past month for context, the same basis and own amount), so the footer
 * is exactly what Ahead draws, and from a second forecast without anything typed for the suggestions.
 */
export async function loadPlan(
  db: Db,
  today: string,
  opts: { months: number; basis: PlanBasis },
): Promise<Plan> {
  const { months: ahead, basis } = opts;
  if (!Number.isInteger(ahead) || ahead < 1 || ahead > PLAN_HORIZON_MONTHS)
    throw new PlanError(`months must be a whole number from 1 to ${PLAN_HORIZON_MONTHS}.`);
  const current = monthOf(today);
  const last = addMonths(current, ahead);
  const own = basis === "own" ? await getOwnSpending(db) : null;
  // "My own" without an amount falls back to the averages, as on Ahead.
  const effective: PlanBasis = basis === "own" && own === null ? "averages" : basis;
  const forecastOpts = { today, months: ahead, pastMonths: 1, basis, ownSpending: own };
  const f = await getForecast(db, forecastOpts);
  const base = await getForecast(db, { ...forecastOpts, ignorePlan: true });
  const points = buildPrognose(f, "en", effective).points;

  const shown = f.months.filter((m) => m.month >= current);
  const baseOf = new Map(base.months.map((m) => [m.month, m]));
  const months = shown.map((m) => m.month);
  const typed = indexOverrides(await getPlanOverrides(db, { from: current, to: last }));
  const items = new Map((await db.select().from(schema.recurringItems)).map((i) => [i.id, i]));
  const savings = await savingsCategoryIds(db);

  // Fixed items: per item and month, the money counted (a carried-over line of an earlier month adds to it).
  const itemAmounts = (m: ForecastMonth | undefined, type: "income" | "expense") => {
    const out = new Map<number, number>();
    for (const o of m?.recurring.occurrences ?? [])
      if (
        o.counted !== "none" &&
        o.type === type &&
        !(o.categoryId !== null && savings.has(o.categoryId))
      )
        out.set(o.recurringItemId, (out.get(o.recurringItemId) ?? 0) + o.amount);
    return out;
  };
  const itemRows = (type: "income" | "expense"): PlanRow[] => {
    const ids: number[] = [];
    for (const m of shown)
      for (const id of itemAmounts(m, type).keys()) if (!ids.includes(id)) ids.push(id);
    return ids.map((id) => {
      const item = items.get(id);
      return {
        key: `item-${id}`,
        name: item?.name ?? null,
        kind: "item",
        id,
        cells: shown.map((m): PlanCell => {
          const amount = itemAmounts(m, type).get(id) ?? 0;
          const suggestion = itemAmounts(baseOf.get(m.month), type).get(id) ?? 0;
          const t = typed.items.get(overrideKey(id, m.month)) ?? null;
          // Typing only changes a line of this month that is still expected.
          const open = m.recurring.occurrences.some(
            (o) =>
              o.recurringItemId === id &&
              o.month === m.month &&
              !o.carriedOver &&
              o.counted === "projected",
          );
          return {
            month: m.month,
            amount,
            source: t !== null ? "typed" : "item",
            suggestion,
            why: { type: "fixed" },
            redundant: t !== null && item !== undefined && t === item.expectedAmount,
            editable: open,
            typed: t,
          };
        }),
      };
    });
  };
  const income = itemRows("income");
  const fixed = itemRows("expense");

  // Real income that is not a fixed item (the current month): the income rows still add up to the footer.
  const incomeOther = computedRow(
    "income-other",
    shown.map((m) => m.month),
    shown.map(
      (m) => m.income - sum(income.map((r) => r.cells.find((c) => c.month === m.month)!.amount)),
    ),
    shown.map((m) => {
      const b = baseOf.get(m.month)!;
      return b.income - sum([...itemAmounts(b, "income").values()]);
    }),
  );
  if (incomeOther.cells.some((c) => c.amount !== 0)) income.push(incomeOther);

  // Everyday spending per category: its total less the fixed items in it (real spending so far included).
  const everyday = (m: ForecastMonth | undefined, id: number | null) => {
    const c = m?.categories.find((x) => x.categoryId === id);
    if (!m || !c) return 0;
    return c.total - sum(m.parts.fixed.filter((p) => p.categoryId === id).map((p) => p.amount));
  };
  const budgets =
    effective === "budget"
      ? await getBudgetsByMonth(db, current, last, { carryForwardFrom: current })
      : null;
  const averageWhy: PlanWhy =
    effective === "own" ? { type: "own" } : { type: "average", months: f.variableBasis.months };
  const why = (id: number, month: string): PlanWhy => {
    const b = budgets?.get(month);
    if (!b?.byCategory.has(id)) return averageWhy;
    const carried = b.carriedFrom.get(id);
    if (carried !== undefined) return { type: "carried", from: carried };
    if (b.explicit.has(id)) return { type: "budget", from: month };
    return { type: "fixed" };
  };
  const categoryRows: PlanRow[] = (shown[0]?.categories ?? [])
    .filter((c) => c.categoryId !== null)
    .map((c) => {
      const id = c.categoryId!;
      return {
        key: `category-${id}`,
        name: c.name,
        kind: "category",
        id,
        cells: shown.map((m): PlanCell => {
          const t = typed.categories.get(overrideKey(id, m.month)) ?? null;
          return {
            month: m.month,
            amount: everyday(m, id),
            source: t !== null ? "typed" : "suggestion",
            suggestion: everyday(baseOf.get(m.month), id),
            why: why(id, m.month),
            redundant: false,
            editable: true,
            typed: t,
          };
        }),
      };
    });
  const uncategorised: PlanRow = {
    ...computedRow(
      "uncategorised",
      months,
      shown.map((m) => everyday(m, null)),
      shown.map((m) => everyday(baseOf.get(m.month), null)),
    ),
  };
  for (const c of uncategorised.cells) c.why = averageWhy;
  const allCategories = uncategorised.cells.some((c) => c.amount !== 0)
    ? [...categoryRows, uncategorised]
    : categoryRows;

  // Shown by default: anything typed in these months, and the biggest five; the rest is one row.
  const totalOf = (r: PlanRow) => sum(r.cells.map((c) => c.amount));
  const biggest = [...categoryRows]
    .filter((r) => totalOf(r) > 0)
    .sort((a, b) => totalOf(b) - totalOf(a))
    .slice(0, BIGGEST);
  const visible = categoryRows
    .filter((r) => biggest.includes(r) || r.cells.some((c) => c.typed !== null))
    .sort((a, b) => totalOf(b) - totalOf(a));
  const hidden = allCategories.filter((r) => !visible.includes(r));
  const other = computedRow(
    "other",
    months,
    months.map((_, i) => sum(hidden.map((r) => r.cells[i].amount))),
    months.map((_, i) => sum(hidden.map((r) => r.cells[i].suggestion))),
  );
  const variable = other.cells.some((c) => c.amount !== 0) ? [...visible, other] : visible;

  // The BTW to set aside from the client's income (typed income included), never typed.
  const btwCells: PlanCell[] = [];
  for (const month of months) {
    const { share } = await btwShareForMonth(db, { month, today });
    btwCells.push(computedCell(month, share, share));
  }
  const btw: PlanRow = { key: "btw", name: null, kind: "btw", id: null, cells: btwCells };

  return {
    currentMonth: current,
    months,
    basis: effective,
    horizon: PLAN_HORIZON_MONTHS,
    sections: { income, fixed, btw: [btw], variable },
    allCategories,
    footer: shown.map((m) => {
      const point = points.find((p) => p.month === m.month)!;
      return {
        month: m.month,
        income: m.income,
        expenses: m.expenses,
        growth: m.net,
        netWorth: point.cumulative,
        low: m.low,
      };
    }),
  };
}

function computedCell(month: string, amount: number, suggestion: number): PlanCell {
  return {
    month,
    amount,
    source: "computed",
    suggestion,
    why: null,
    redundant: false,
    editable: false,
    typed: null,
  };
}

function computedRow(
  key: string,
  months: string[],
  amounts: number[],
  suggestions: number[],
): PlanRow {
  return {
    key,
    name: null,
    kind: "other",
    id: null,
    cells: months.map((month, i) => computedCell(month, amounts[i], suggestions[i])),
  };
}
