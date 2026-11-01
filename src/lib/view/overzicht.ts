import type { Mood, Tone } from "@/design/tokens";
import type { Locale } from "@/i18n/config";
import type { SavingsSummary } from "@/lib/savings/summary";
import { messages } from "@/i18n/messages";
import type { Sentence } from "@/i18n/types";
import type { IncomeLine, MonthOverview } from "@/lib/budget/overview";
import { daysInMonth } from "@/lib/recurring/dates";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { categoryLabel } from "./categories";
import { formatter, monthProgress } from "./format";
import { barState, moodForTone, toneForUsage } from "./status";

export type { Sentence };

/** How a bar is drawn: `done` = a fixed cost that is paid, `planned` = still to come, `bad` = over budget. */
export type BarKind = "none" | "ok" | "warn" | "bad" | "done" | "planned";

/** The default savings category, found by its stable slug so a renamed category still counts. */
const SAVINGS_SLUG = "saving-investing";

export interface OverzichtRow {
  categoryId: number | null;
  name: string;
  actual: number;
  /** Fixed costs of this category that are still to come this month. */
  planned: number;
  /** Date of the next unpaid fixed cost in this category, for "komt 25 okt". */
  nextDate: string | null;
  budget: number | null;
  /** A fixed cost lives in this category this month. */
  fixed: boolean;
  state: BarKind;
}

export interface AttentionItem {
  key: string;
  tone: Tone;
  title: string;
  sub: string;
  action: { href: string; label: string; primary: boolean };
}

/** The pace of everyday spending (money that is not a fixed cost) through the month. */
export interface PaceCard {
  /** Everyday spending: the month's spending without the fixed costs already paid. */
  spent: number;
  /** All spending this month and the fixed costs paid in it: `fixed + spent === total` (unless fixed exceeds it). */
  total: number;
  fixed: number;
  /** Budget for everyday spending (total budget minus fixed costs); null when there is none. */
  budget: number | null;
  /** What should be spent by now at an even pace; null without a budget. */
  schedule: number | null;
  /** Schedule minus spent: positive = ahead of schedule (spent less than planned). */
  ahead: number | null;
  /** Share of the month that has passed, 0..1. */
  progress: number;
  tone: Tone;
  days: { day: number; amount: number; state: "past" | "today" | "future" }[];
  /** Days with at least this much (cents) are drawn dark and numbered. */
  threshold: number;
}

export interface IncomeRow {
  key: string;
  name: string;
  /** Stored category name for the icon; null for none. */
  category: string | null;
  status: "received" | "expected" | "missing";
  date: string | null;
  amount: number;
}

export interface UpcomingRow {
  key: string;
  name: string;
  category: string | null;
  date: string;
  amount: number;
}

export interface Tile {
  key: "budget" | "vast" | "sparen" | "inkomen";
  label: string;
  word: string;
  sub: string;
  tone: Tone;
  /** Only the savings tile, and only when there is a goal: cents saved and the goal. It is shown as a progress card. */
  goal?: { saved: number; target: number };
}

export interface Overzicht {
  month: string;
  hasActivity: boolean;
  /**
   * What the ring and the sentence compare spending with: the total budget (the one typed, else the sum of the
   * category budgets), else what came in this month, else nothing.
   */
  basis: "budget" | "income" | "none";
  /** Small lines under the header: over or under budget, income still to come, fixed costs still to pay (at most two). */
  facts: string[];
  /** The Savings row among the categories: the total saved, this month's movement and the goal. Null when unknown. */
  savingsRow: { saved: number; thisMonth: number; goal: number | null } | null;
  /** What the accounts hold plus what is saved, or null when neither is known. */
  netWorth: { accounts: number; savings: number; total: number } | null;
  budget: number | null;
  spent: number;
  /** What the budget is compared with: all spending for a typed total, the budgeted categories only for a sum. */
  budgetSpent: number;
  /** Fixed expenses still to come (expected, not yet matched). */
  planned: number;
  /** Share of the budget that is spent or already planned; null without a budget. */
  used: number | null;
  tone: Tone;
  mood: Mood;
  /** What is left after spending and the fixed costs that are still to come. Null without a budget. */
  free: number | null;
  sentence: Sentence;
  /** A line or two that explain the sentence; null when there is nothing to add. */
  detail: string | null;
  attention: AttentionItem[];
  tiles: Tile[];
  pace: PaceCard | null;
  rows: OverzichtRow[];
  income: IncomeRow[];
  /** Money received this month (cents). */
  incomeReceived: number;
  /** The next fixed costs to pay (current month only). */
  upcoming: UpcomingRow[];
  transactionCount: number;
}

interface Input {
  overview: MonthOverview;
  occurrences: OccurrenceView[];
  today: string;
  locale: Locale;
  /** Everyday spending per day (index 0 = the 1st), see getDailySpend. */
  daily?: number[];
  /** Money in that is not tied to a fixed income item, see getOtherIncome. */
  otherIncome?: IncomeLine[];
  /** Money in and out of savings, and the goal, see getSavingsSummary. */
  savings?: SavingsSummary | null;
  /** What the accounts hold now (cents) from the bank's own balances, see getOpeningBalance; null when unknown. */
  accountsBalance?: number | null;
}

/**
 * The header's main line: the days left in the month, worded for how the month is going (the ring already shows how
 * much is over or under). The wording rotates with the day, so the page is not the same every time.
 */
function daysToGo(month: string, today: string, locale: Locale, used: number | null): Sentence {
  const t = messages[locale].view.overzicht;
  if (today.slice(0, 7) !== month)
    return today > month ? t.headerDone(formatter(locale).monthName(month)) : t.headerNotStarted;
  const day = Number(today.slice(8, 10));
  const days = daysInMonth(month) - day;
  if (days <= 0) return t.headerLastDay;
  const variants =
    used !== null && used > 1
      ? t.headerOver
      : used !== null && used > 0.85
        ? t.headerTight
        : t.headerOk;
  return variants[day % variants.length](t.daysText(days));
}

function sentenceFor(o: {
  month: string;
  today: string;
  budget: number | null;
  spent: number;
  fixedTotal: number;
  paidFixed: number;
  locale: Locale;
}): Sentence {
  const { budget, spent, fixedTotal, paidFixed } = o;
  const t = messages[o.locale].view.overzicht;
  const { euro } = formatter(o.locale);
  if (budget === null) return t.noBudget(euro(spent));
  const progress = monthProgress(o.month, o.today);
  if (progress === 0) return t.notStarted(euro(fixedTotal));
  if (progress === 1) {
    const diff = budget - spent;
    return diff >= 0 ? t.pastUnder(euro(diff)) : t.pastOver(euro(-diff));
  }
  const variableBudget = budget - fixedTotal;
  // A rent paid just before the month starts is matched here but not counted in this month's spending.
  const variableSpent = Math.max(spent - paidFixed, 0);
  if (variableBudget <= 0) return t.fixedTakeAll(euro(fixedTotal));
  if (progress < 0.1) return t.justStarted(euro(variableBudget));
  const pace = variableSpent / variableBudget / progress;
  if (pace < 0.9) return t.paceUnder(euro(variableSpent), euro(variableBudget));
  if (pace <= 1.1) return t.paceOn(euro(variableSpent), euro(variableBudget));
  return t.paceOver(euro(variableSpent), euro(variableBudget));
}

/** What needs a look: loose transactions, income that has not shown up, payments not found. */
function buildAttention({
  overview,
  occurrences,
  today,
  locale,
}: Pick<Input, "overview" | "occurrences" | "today" | "locale">): AttentionItem[] {
  const t = messages[locale].view.overzicht.attention;
  const { dayLabel } = formatter(locale);
  const out: AttentionItem[] = [];
  if (overview.uncategorised.count > 0)
    out.push({
      key: "uncategorised",
      tone: "bad",
      title: t.uncategorised(overview.uncategorised.count),
      sub: t.uncategorisedSub,
      action: { href: "/upload", label: t.sort, primary: true },
    });
  const late = occurrences
    .filter(
      (o) =>
        o.status === "missed" ||
        (o.type === "income" && o.status === "expected" && o.expectedDate < today),
    )
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  for (const o of late)
    out.push({
      key: `late${o.id}`,
      tone: "warn",
      title: o.type === "income" ? t.incomeMissing(o.itemName) : t.expenseMissing(o.itemName),
      sub: t.expectedOn(dayLabel(o.expectedDate)),
      action: { href: "/fixed-costs", label: t.view, primary: false },
    });
  if (overview.foreignCurrencyCount > 0)
    out.push({
      key: "foreign",
      tone: "warn",
      title: t.foreign(overview.foreignCurrencyCount),
      sub: t.foreignSub,
      action: { href: "/upload", label: t.sort, primary: false },
    });
  return out.slice(0, 3);
}

function sparenTile(
  overview: MonthOverview,
  locale: Locale,
  savings?: SavingsSummary | null,
): Tile {
  const t = messages[locale].view.overzicht.tiles.sparen;
  const { euro, euroExact } = formatter(locale);
  const own = { key: "sparen" as const, label: t.label };
  // Real savings (the Savings category) and the goal come first: a deposit raises the progress, a withdrawal lowers it.
  if (savings && savings.goal !== null) {
    const reached = savings.saved >= savings.goal;
    return {
      ...own,
      word: reached ? t.wordReached : t.wordUnderway,
      sub: t.subOf(euro(savings.saved), euro(savings.goal)),
      tone: reached ? "good" : "accent",
      goal: { saved: savings.saved, target: savings.goal },
    };
  }
  if (savings && (savings.lines > 0 || savings.anchored)) {
    // The total is the headline; this month's movement is the sub-line.
    const word = euroExact(savings.saved);
    if (savings.thisMonth > 0)
      return { ...own, word, sub: t.subMonth(euro(savings.thisMonth)), tone: "good" };
    if (savings.thisMonth < 0)
      return { ...own, word, sub: t.subMonthTaken(euro(-savings.thisMonth)), tone: "warn" };
    return { ...own, word, sub: t.subTotalOnly, tone: "accent" };
  }
  const line = overview.expenses.find((l) => l.slug === SAVINGS_SLUG);
  const actual = line?.actual ?? 0;
  const goal = line?.budget ?? null;
  const base = { key: "sparen" as const, label: t.label };
  if (goal !== null && goal > 0) {
    if (actual >= goal)
      return { ...base, word: t.wordReached, sub: t.subMonth(euro(actual)), tone: "good" };
    return {
      ...base,
      word: t.wordUnderway,
      sub: t.subOf(euro(actual), euro(goal)),
      tone: "accent",
    };
  }
  if (actual > 0)
    return { ...base, word: t.wordSaved, sub: t.subMonth(euro(actual)), tone: "good" };
  return { ...base, word: t.wordNone, sub: t.subNone, tone: "accent" };
}

/** Pure view model for the Overzicht screen. All money is cents. */
export function buildOverzicht({
  overview,
  occurrences,
  today,
  locale,
  daily = [],
  otherIncome = [],
  savings = null,
  accountsBalance = null,
}: Input): Overzicht {
  const t = messages[locale].view.overzicht;
  const { euro, dayLabel } = formatter(locale);
  const { month, totals } = overview;
  const spent = totals.expenseActual;
  // The total budget is the one typed, else the sum of the category budgets (fixed costs included).
  const sumBudget =
    !totals.totalBudgetIsExplicit && totals.totalBudget !== null && totals.totalBudget > 0
      ? totals.totalBudget
      : null;
  const budget = totals.totalBudgetIsExplicit ? totals.totalBudget : sumBudget;
  // A sum covers only the categories that have a budget, so it is compared with their spending only; the rest is
  // reported next to it, never called "over budget".
  const budgetedSpent = overview.expenses
    .filter((l) => l.budget !== null)
    .reduce((s, l) => s + l.actual, 0);
  const budgetSpent = sumBudget !== null ? budgetedSpent : spent;
  const unbudgeted = sumBudget !== null ? spent - budgetedSpent : 0;
  // The header with days to go and the facts: for a budget that is a sum, and when there is only income to go by.
  const compact = sumBudget !== null || (budget === null && totals.incomeActual > 0);

  const expenseOcc = occurrences.filter((o) => o.type === "expense");
  const planned = expenseOcc
    .filter((o) => o.status === "expected")
    .reduce((s, o) => s + o.expectedAmount, 0);
  const paidFixed = expenseOcc
    .filter((o) => o.status === "matched")
    .reduce((s, o) => s + (o.actualAmount ?? 0), 0);
  const fixedTotal = expenseOcc
    .filter((o) => o.status !== "missed")
    .reduce((s, o) => s + o.amount, 0);

  const incomeBasis = budget === null && totals.incomeActual > 0;
  const reference =
    budget !== null && budget > 0 ? budget : incomeBasis ? totals.incomeActual : null;
  const basis: Overzicht["basis"] = budget !== null ? "budget" : incomeBasis ? "income" : "none";
  const used = reference !== null ? (budgetSpent + planned) / reference : null;
  const tone: Tone = used === null ? "accent" : toneForUsage(used);
  const free =
    budget !== null
      ? budget - budgetSpent - planned
      : incomeBasis
        ? totals.incomeActual - spent - planned
        : null;

  const rows: OverzichtRow[] = overview.expenses
    .map((l) => {
      const mine = expenseOcc.filter(
        (o) => o.categoryId === l.categoryId && o.status === "expected",
      );
      const fixed = expenseOcc.some((o) => o.categoryId === l.categoryId && o.status !== "missed");
      const plannedHere = mine.reduce((s, o) => s + o.expectedAmount, 0);
      const total = l.actual + plannedHere;
      const state: BarKind =
        l.budget !== null && l.budget > 0 && total > l.budget
          ? "bad"
          : fixed && plannedHere === 0 && l.actual > 0
            ? "done"
            : fixed && l.actual === 0 && plannedHere > 0
              ? "planned"
              : barState(total, l.budget);
      return {
        categoryId: l.categoryId,
        name: l.name,
        actual: l.actual,
        planned: plannedHere,
        nextDate: mine.map((o) => o.expectedDate).sort()[0] ?? null,
        budget: l.budget,
        fixed,
        state,
      };
    })
    .filter((r) => r.actual > 0 || r.planned > 0 || r.budget !== null);
  if (overview.uncategorised.expense > 0)
    rows.push({
      categoryId: null,
      name: t.uncategorised,
      actual: overview.uncategorised.expense,
      planned: 0,
      nextDate: null,
      budget: null,
      fixed: false,
      state: "none",
    });
  rows.sort((a, b) => b.actual + b.planned - (a.actual + a.planned));

  const incomeOcc = occurrences.filter((o) => o.type === "income");
  const incomeToCome = incomeOcc
    .filter((o) => o.status === "expected")
    .reduce((s, o) => s + o.expectedAmount, 0);
  const paid = expenseOcc.filter((o) => o.status === "matched").length;
  const tiles: Tile[] = [
    {
      key: "budget",
      label: t.tiles.budget.label,
      word: t.tone[tone],
      sub:
        budget === null
          ? t.tiles.budget.subNone
          : t.tiles.budget.sub(euro(budgetSpent + planned), euro(budget)),
      tone,
    },
    {
      key: "vast",
      label: t.tiles.vast.label,
      word:
        expenseOcc.length === 0 ? t.tiles.vast.none : t.tiles.vast.word(paid, expenseOcc.length),
      sub:
        planned > 0
          ? t.tiles.vast.subToGo(euro(planned))
          : expenseOcc.length
            ? t.tiles.vast.subAllPaid
            : t.tiles.vast.subNone,
      tone: "accent",
    },
    sparenTile(overview, locale, savings),
    {
      key: "inkomen",
      label: t.tiles.inkomen.label,
      word: t.tiles.inkomen.word(euro(totals.incomeActual)),
      sub:
        incomeToCome > 0
          ? t.tiles.inkomen.subExpected(euro(incomeToCome))
          : t.tiles.inkomen.subNone,
      tone: "good",
    },
  ];

  const hasActivity =
    spent > 0 || totals.incomeActual > 0 || occurrences.length > 0 || budget !== null;

  const progress = monthProgress(month, today);
  const variableBudget = budget === null ? null : budget - fixedTotal;
  const variableSpent = Math.max(budgetSpent - paidFixed, 0);
  const attention = buildAttention({ overview, occurrences, today, locale });

  // A line or two under the sentence: how much of the budget is gone and what is over.
  let detail: string | null = null;
  if (basis === "budget" && used !== null && free !== null && progress > 0 && progress < 1) {
    const d = messages[locale].view.overzicht.detail;
    const days = daysInMonth(month) - Number(today.slice(8, 10));
    const pct = Math.round(used * 100);
    const line =
      free > 0 && days > 0
        ? d.withPerDay(pct, days, euro(Math.floor(free / days)))
        : d.withoutPerDay(pct, days);
    const over = rows
      .filter((r) => r.budget !== null && r.actual + r.planned > r.budget)
      .sort((a, b) => b.actual + b.planned - b.budget! - (a.actual + a.planned - a.budget!))
      .map((r) => categoryLabel(r.name, locale));
    const overLine =
      over.length === 0
        ? ""
        : over.length === 1
          ? d.overOne(over[0])
          : over.length === 2
            ? d.overTwo(over[0], over[1])
            : d.overMany(over[0], over[1], over.length - 2);
    detail = overLine ? `${line} ${overLine}` : line;
  }

  // Everyday spending through the month, one bar per day.
  let pace: PaceCard | null = null;
  const dayCount = daysInMonth(month);
  const hasVariableBudget = variableBudget !== null && variableBudget > 0;
  if (daily.some((a) => a > 0) || (hasVariableBudget && progress > 0)) {
    const nowDay =
      today.slice(0, 7) === month ? Number(today.slice(8, 10)) : today > month ? dayCount + 1 : 0;
    const allowance = hasVariableBudget
      ? variableBudget / dayCount
      : variableSpent / Math.max(nowDay, 1);
    const schedule = hasVariableBudget ? Math.round(variableBudget * progress) : null;
    const ratio =
      hasVariableBudget && progress > 0 ? variableSpent / variableBudget / progress : null;
    pace = {
      spent: variableSpent,
      total: budgetSpent,
      fixed: Math.min(paidFixed, budgetSpent),
      budget: hasVariableBudget ? variableBudget : null,
      schedule,
      ahead: schedule === null ? null : schedule - variableSpent,
      progress,
      tone: ratio === null ? "accent" : ratio <= 1 ? "good" : ratio <= 1.1 ? "accent" : "warn",
      days: Array.from({ length: dayCount }, (_, i) => ({
        day: i + 1,
        amount: daily[i] ?? 0,
        state: i + 1 < nowDay ? "past" : i + 1 === nowDay ? "today" : "future",
      })),
      threshold: Math.max(2000, Math.round((3 * allowance) / 500) * 500),
    };
  }

  const nameById = new Map<number | null, string>(
    [...overview.expenses, ...overview.income].map((l) => [l.categoryId, l.name]),
  );
  const income: IncomeRow[] = [];
  for (const o of incomeOcc) {
    const overdue = o.status === "missed" || (o.status === "expected" && o.expectedDate < today);
    income.push({
      key: `occ${o.id}`,
      name: o.itemName,
      category: nameById.get(o.categoryId) ?? null,
      status: o.status === "matched" ? "received" : overdue ? "missing" : "expected",
      date: o.status === "matched" ? (o.actualDate ?? o.expectedDate) : o.expectedDate,
      amount: o.status === "matched" ? (o.actualAmount ?? o.amount) : o.expectedAmount,
    });
  }
  for (const l of otherIncome)
    income.push({
      key: `cat${l.categoryId ?? "none"}`,
      name: l.name === null ? t.uncategorised : categoryLabel(l.name, locale),
      category: l.name,
      status: "received",
      date: l.lastDate,
      amount: l.amount,
    });
  const order = { received: 0, expected: 1, missing: 1 } as const;
  income.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (a.status === "received" ? b.amount - a.amount : (a.date ?? "").localeCompare(b.date ?? "")),
  );

  const upcoming: UpcomingRow[] =
    today.slice(0, 7) === month
      ? expenseOcc
          .filter((o) => o.status === "expected" && o.expectedDate >= today)
          .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
          .slice(0, 3)
          .map((o) => ({
            key: `occ${o.id}`,
            name: o.itemName,
            category: nameById.get(o.categoryId) ?? null,
            date: o.expectedDate,
            amount: o.expectedAmount,
          }))
      : [];

  // Small lines under the header. Which ones show rotates with the day so the page is not the same every time.
  function headerFacts(): string[] {
    const f = messages[locale].view.overzicht.facts;
    // Only what is worth a line: a real overspend (at least 5 euro), and room left in a category that is spent on
    // (rent that is simply not paid yet is not "under budget").
    const withBudget = rows.filter((r) => r.categoryId !== null && r.budget !== null);
    const over = withBudget
      .filter((r) => r.actual - r.budget! >= 500)
      .sort((a, b) => b.actual - b.budget! - (a.actual - a.budget!))[0];
    const under = withBudget
      .filter((r) => !r.fixed && r.actual > 0 && r.budget! - r.actual >= 2000)
      .sort((a, b) => b.budget! - b.actual - (a.budget! - a.actual))[0];
    const coming = incomeOcc
      .filter((o) => o.status === "expected")
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))[0];
    const openFixed = expenseOcc.filter((o) => o.status === "expected");
    const candidates: string[] = [];
    if (over)
      candidates.push(f.over(categoryLabel(over.name, locale), euro(over.actual - over.budget!)));
    if (coming)
      candidates.push(
        f.income(coming.itemName, euro(coming.expectedAmount), dayLabel(coming.expectedDate)),
      );
    if (openFixed.length > 0) candidates.push(f.fixed(openFixed.length, euro(planned)));
    if (under)
      candidates.push(
        f.under(categoryLabel(under.name, locale), euro(under.budget! - under.actual)),
      );
    // Spending outside the budget is always said, so the total never seems to leave something out.
    const outside = unbudgeted >= 500 ? [f.unbudgeted(euro(unbudgeted))] : [];
    if (candidates.length === 0) return outside;
    const start = Number(today.slice(8, 10)) % candidates.length;
    return Array.from(
      { length: Math.min(2 - outside.length, candidates.length) },
      (_, i) => candidates[(start + i) % candidates.length],
    ).concat(outside);
  }

  return {
    month,
    hasActivity,
    basis,
    facts: compact ? headerFacts() : [],
    savingsRow:
      savings && (savings.anchored || savings.lines > 0 || savings.saved > 0)
        ? { saved: savings.saved, thisMonth: savings.thisMonth, goal: savings.goal }
        : null,
    netWorth:
      accountsBalance === null && (savings === null || (savings.saved === 0 && !savings.anchored))
        ? null
        : (() => {
            const accounts = accountsBalance ?? 0;
            const saved = savings?.saved ?? 0;
            return { accounts, savings: saved, total: accounts + saved };
          })(),
    budget,
    spent,
    budgetSpent,
    planned,
    used,
    tone,
    mood: moodForTone(tone),
    free,
    sentence: compact
      ? daysToGo(month, today, locale, used)
      : sentenceFor({ month, today, budget, spent: budgetSpent, fixedTotal, paidFixed, locale }),
    detail: compact
      ? budget !== null
        ? messages[locale].view.overzicht.headerTotalsBudget(
            euro(budgetSpent),
            euro(budget),
            euro(totals.incomeActual),
          )
        : messages[locale].view.overzicht.headerTotals(euro(spent), euro(totals.incomeActual))
      : detail,
    attention,
    tiles,
    pace,
    rows,
    income: income.slice(0, 6),
    incomeReceived: totals.incomeActual,
    upcoming,
    transactionCount: overview.transactionCount,
  };
}
