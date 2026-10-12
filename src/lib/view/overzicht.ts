import type { Mood, Tone } from "@/design/tokens";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import type { Sentence } from "@/i18n/types";
import type { MonthOverview } from "@/lib/budget/overview";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { formatter, monthProgress } from "./format";
import { barState, moodForTone, toneForUsage } from "./status";

export type { Sentence };

export interface OverzichtRow {
  categoryId: number | null;
  name: string;
  actual: number;
  /** Fixed costs of this category that are still to come this month. */
  planned: number;
  /** Date of the next unpaid fixed cost in this category, for "komt 25 okt". */
  nextDate: string | null;
  budget: number | null;
  state: "none" | "ok" | "warn" | "bad";
}

export interface Tile {
  key: "budget" | "vast" | "inkomen" | "sorteren";
  label: string;
  word: string;
  sub: string;
  tone: Tone;
}

export interface Overzicht {
  month: string;
  hasActivity: boolean;
  budget: number | null;
  spent: number;
  /** Fixed expenses still to come (expected, not yet matched). */
  planned: number;
  /** Share of the budget that is spent or already planned; null without a budget. */
  used: number | null;
  tone: Tone;
  mood: Mood;
  /** What is left after spending and the fixed costs that are still to come. Null without a budget. */
  free: number | null;
  sentence: Sentence;
  tiles: Tile[];
  rows: OverzichtRow[];
}

interface Input {
  overview: MonthOverview;
  occurrences: OccurrenceView[];
  today: string;
  locale: Locale;
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

/** Pure view model for the Overzicht screen. All money is cents. */
export function buildOverzicht({ overview, occurrences, today, locale }: Input): Overzicht {
  const t = messages[locale].view.overzicht;
  const { euro } = formatter(locale);
  const { month, totals } = overview;
  const budget = totals.totalBudget;
  const spent = totals.expenseActual;

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

  const used = budget !== null && budget > 0 ? (spent + planned) / budget : null;
  const tone: Tone = used === null ? "accent" : toneForUsage(used);
  const free = budget === null ? null : budget - spent - planned;

  const rows: OverzichtRow[] = overview.expenses
    .map((l) => {
      const mine = expenseOcc.filter(
        (o) => o.categoryId === l.categoryId && o.status === "expected",
      );
      return {
        categoryId: l.categoryId,
        name: l.name,
        actual: l.actual,
        planned: mine.reduce((s, o) => s + o.expectedAmount, 0),
        nextDate: mine.map((o) => o.expectedDate).sort()[0] ?? null,
        budget: l.budget,
        state: barState(l.actual + mine.reduce((s, o) => s + o.expectedAmount, 0), l.budget),
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
          : t.tiles.budget.sub(euro(spent + planned), euro(budget)),
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
    {
      key: "sorteren",
      label: t.tiles.sorteren.label,
      word:
        overview.uncategorised.count === 0
          ? t.tiles.sorteren.wordNone
          : t.tiles.sorteren.word(overview.uncategorised.count),
      sub: overview.uncategorised.count === 0 ? t.tiles.sorteren.subNone : t.tiles.sorteren.sub,
      tone: overview.uncategorised.count === 0 ? "good" : "warn",
    },
  ];

  const hasActivity =
    spent > 0 || totals.incomeActual > 0 || occurrences.length > 0 || budget !== null;

  return {
    month,
    hasActivity,
    budget,
    spent,
    planned,
    used,
    tone,
    mood: moodForTone(tone),
    free,
    sentence: sentenceFor({ month, today, budget, spent, fixedTotal, paidFixed, locale }),
    tiles,
    rows,
  };
}
