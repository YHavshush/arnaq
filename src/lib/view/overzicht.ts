import type { Mood, Tone } from "@/design/tokens";
import type { MonthOverview } from "@/lib/budget/overview";
import type { OccurrenceView } from "@/lib/recurring/occurrences";
import { euro, monthProgress } from "./format";
import { barState, moodForTone, toneForUsage } from "./status";

/** A sentence made of plain and emphasised (italic serif) parts. */
export type Sentence = { text: string; em?: boolean }[];

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
}

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });

function sentenceFor(o: {
  month: string;
  today: string;
  budget: number | null;
  spent: number;
  fixedTotal: number;
  paidFixed: number;
}): Sentence {
  const { budget, spent, fixedTotal, paidFixed } = o;
  if (budget === null)
    return [
      plain("Je hebt deze maand "),
      em(euro(spent)),
      plain(" uitgegeven. Stel een budget in om te zien wat er vrij is."),
    ];
  const progress = monthProgress(o.month, o.today);
  if (progress === 0)
    return [
      plain("Deze maand is nog niet begonnen. Je vaste lasten zijn "),
      em(euro(fixedTotal)),
      plain("."),
    ];
  if (progress === 1) {
    const diff = budget - spent;
    return diff >= 0
      ? [plain("Je bleef "), em(euro(diff)), plain(" onder je budget.")]
      : [plain("Je ging "), em(euro(-diff)), plain(" over je budget.")];
  }
  const variableBudget = budget - fixedTotal;
  const variableSpent = spent - paidFixed;
  if (variableBudget <= 0)
    return [
      plain("Je vaste lasten ("),
      em(euro(fixedTotal)),
      plain(") nemen je hele budget in beslag."),
    ];
  if (progress < 0.1)
    return [
      plain("De maand is net begonnen: "),
      em(euro(variableBudget)),
      plain(" voor gewone uitgaven."),
    ];
  const pace = variableSpent / variableBudget / progress;
  const tail = [plain(": "), em(euro(variableSpent)), plain(` van ${euro(variableBudget)}.`)];
  if (pace < 0.9) return [plain("Je gewone uitgaven blijven ruim binnen schema"), ...tail];
  if (pace <= 1.1) return [plain("Je gewone uitgaven lopen precies op schema"), ...tail];
  return [plain("Je gewone uitgaven lopen sneller dan je budget"), ...tail];
}

const WORD: Record<Tone, string> = {
  good: "Op schema",
  warn: "Krap",
  bad: "Over budget",
  accent: "Geen budget",
};

/** Pure view model for the Overzicht screen. All money is cents. */
export function buildOverzicht({ overview, occurrences, today }: Input): Overzicht {
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
      name: "Zonder categorie",
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
      label: "Budget",
      word: WORD[tone],
      sub: budget === null ? "Nog niet ingesteld" : `${euro(spent + planned)} van ${euro(budget)}`,
      tone,
    },
    {
      key: "vast",
      label: "Vaste lasten",
      word: expenseOcc.length === 0 ? "Geen" : `${paid}/${expenseOcc.length} betaald`,
      sub:
        planned > 0
          ? `nog ${euro(planned)} te gaan`
          : expenseOcc.length
            ? "Alles betaald"
            : "Nog niets ingesteld",
      tone: "accent",
    },
    {
      key: "inkomen",
      label: "Inkomen",
      word: `${euro(totals.incomeActual)} binnen`,
      sub: incomeToCome > 0 ? `nog ${euro(incomeToCome)} verwacht` : "Niets meer verwacht",
      tone: "good",
    },
    {
      key: "sorteren",
      label: "Te sorteren",
      word:
        overview.uncategorised.count === 0
          ? "Alles gesorteerd"
          : `${overview.uncategorised.count} open`,
      sub:
        overview.uncategorised.count === 0
          ? "Geen losse transacties"
          : "transacties zonder categorie",
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
    sentence: sentenceFor({ month, today, budget, spent, fixedTotal, paidFixed }),
    tiles,
    rows,
  };
}
