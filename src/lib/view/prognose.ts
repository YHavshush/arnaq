import type { Mood, Tone } from "@/design/tokens";
import type { Forecast, MonthKind } from "@/lib/forecast/forecast";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { formatter } from "./format";
import { expenseParts, incomeParts, type MonthParts } from "./month-parts";
import { moodForTone } from "./status";
import type { Sentence } from "@/i18n/types";

export interface PrognosePoint {
  month: string;
  label: string;
  kind: MonthKind;
  income: number;
  expenses: number;
  net: number;
  /**
   * Net worth at the end of this month (accounts plus savings plus the BTW part) when balances are known, else the
   * growth since the first month plus the BTW part (cents). With balances: `accounts + savings + btw === cumulative`.
   */
  cumulative: number;
  /** The part of `cumulative` in the accounts and the part saved (cents); both 0 when no balances are known. */
  accounts: number;
  savings: number;
  /**
   * The BTW part of `cumulative` (cents): what is in the BTW pocket minus what is owed to the tax office, as far as
   * known. Real months all carry the BTW now (a known limitation: the pocket and what was owed back then are not
   * rebuilt); each month ahead lowers it by `btwAccrued`.
   */
  btw: number;
  /** The BTW that builds up on the client's income expected this month (cents); 0 for real months. */
  btwAccrued: number;
  /** What the month's still expected expenses are made of (see ForecastMonth.expenseSources); zeros for real months. */
  expenseSources: { fixed: number; budgets: number; averages: number; fellBack: string[] };
  /** Money moved into savings this month (cents): not spending, but no longer in the current account. */
  setAside: number;
  /** What is inside `income` and `expenses`: each adds up to its total exactly. */
  incomeParts: MonthParts;
  expenseParts: MonthParts;
  /** Month is not (fully) real money yet: drawn dashed. */
  projected: boolean;
  /**
   * The lowest end-of-day balance of the checking accounts in this month (cents) and the day (YYYY-MM-DD): real
   * days from the statements, the rest simulated day by day. Null when no balance is known.
   */
  low: { amount: number; date: string } | null;
}

export interface Prognose {
  hasForecast: boolean;
  /** Net worth (accounts plus savings, cents) where the real months end and where the forecast ends; null without balances. */
  netWorth: { start: number; end: number } | null;
  /** `cumulative` is a real balance (the person's money), not just growth since the first month. */
  hasBalance: boolean;
  points: PrognosePoint[];
  /** How many points have a low below zero: months in which the checking balance dips into the red. */
  dipMonths: number;
  /** Months ahead (current month included) and how many of them end in the plus. */
  ahead: number;
  inThePlus: number;
  /** Ring fill: share of those months that end in the plus. */
  share: number;
  /** Net growth from the current month to the last forecast month, cents. */
  growth: number;
  /** Real income exists in the data, but none is planned for the coming months (no fixed income). */
  incomeMissing: boolean;
  tone: Tone;
  mood: Mood;
  sentence: Sentence;
  /** One or two lines under the sentence that explain it; null when there is nothing to add. */
  detail: string | null;
  /** Small print under the list: what the numbers do and do not count. */
  notes: string[];
  lowConfidence: string | null;
}

/** Pure view model for the Prognose screen from a Forecast. */
export function buildPrognose(
  f: Forecast,
  locale: Locale,
  basis: "averages" | "budget" | "own" = "averages",
): Prognose {
  const t = messages[locale].view.prognose;
  const { euro, euroSigned, dayLabel, monthName, monthShort } = formatter(locale);
  const hasBalance = f.openingBalance !== null || f.openingSavings !== null;
  const points: PrognosePoint[] = f.months.map((m) => ({
    month: m.month,
    label: monthShort(m.month),
    kind: m.kind,
    income: m.income,
    expenses: m.expenses,
    net: m.net,
    // Money moved into savings leaves the accounts and arrives in savings, so net worth only follows income and
    // spending. The BTW pocket is not savings: real moves into it leave accounts plus savings, and the pocket comes
    // back in whole through the BTW part (the BTW now: pocket minus owed, as on the net worth card). Ahead, a planned
    // move into the pocket changes nothing and the BTW on the client's expected income is owed (see btwWorth).
    cumulative:
      m.cumulativeNet -
      m.cumulativeReserve +
      (f.openingBalance ?? 0) +
      (f.openingSavings ?? 0) +
      (m.btwWorth ?? 0),
    accounts: hasBalance ? m.cumulativeNet - m.cumulativeSetAside + (f.openingBalance ?? 0) : 0,
    savings: hasBalance ? m.cumulativeSetAside - m.cumulativeReserve + (f.openingSavings ?? 0) : 0,
    btw: m.btwWorth ?? 0,
    btwAccrued: m.btwAccrued ?? 0,
    expenseSources: m.expenseSources ?? { fixed: 0, budgets: 0, averages: 0, fellBack: [] },
    setAside: m.setAside.total,
    incomeParts: incomeParts(m, locale),
    expenseParts: expenseParts(m, locale, basis),
    projected: m.kind === "forecast" || m.kind === "mixed",
    low: m.low ?? null,
  }));
  const dipMonths = points.filter((p) => p.low !== null && p.low.amount < 0).length;
  // With no data at all every month nets to 0: that is "nothing to say", not "all in the plus".
  const hasData = points.some((p) => p.income !== 0 || p.expenses !== 0);
  const ahead = hasData ? points.filter((p) => p.projected) : [];
  const inThePlus = ahead.filter((p) => p.net >= 0).length;
  const growth = ahead.reduce((s, p) => s + p.net, 0);
  const share = ahead.length === 0 ? 0 : inThePlus / ahead.length;

  // Income is only forecast from fixed income items. Without any, the future months show spending
  // and no money in, so a "growth" number would be a plain mistake: say what is missing instead.
  const future = points.filter((p) => p.kind === "forecast");
  const incomeMissing =
    future.length > 0 &&
    future.every((p) => p.income === 0) &&
    points.some((p) => !p.projected && p.income > 0);

  const tone: Tone = incomeMissing
    ? "accent"
    : ahead.length === 0
      ? "accent"
      : share === 1
        ? "good"
        : growth >= 0
          ? "warn"
          : "bad";

  let sentence: Sentence = [{ text: t.nothing }];
  let detail: string | null = null;
  if (incomeMissing) {
    sentence = t.noIncome;
  } else if (ahead.length > 0) {
    const sorted = [...ahead].sort((a, b) => a.net - b.net);
    const tight = sorted[0];
    const best = sorted[sorted.length - 1];
    sentence =
      tight.month === best.month
        ? t.single(monthName(tight.month), euroSigned(tight.net))
        : tight.net < 0
          ? t.tightBest(monthName(tight.month), monthName(best.month))
          : t.bestTightest(monthName(best.month), monthName(tight.month));
    const last = ahead[ahead.length - 1];
    detail = (growth >= 0 ? t.detailUp : t.detailDown)(
      euro(Math.abs(growth)),
      monthName(last.month),
      inThePlus,
      ahead.length,
    );
  }

  // Net worth: from where the real months end to where the forecast ends. Without income planned the end is not real.
  const lastReal = [...points].reverse().find((p) => !p.projected) ?? points[0];
  const lastPoint = points[points.length - 1];
  const netWorth =
    hasBalance && lastReal && lastPoint && ahead.length > 0
      ? { start: lastReal.cumulative, end: lastPoint.cumulative }
      : null;
  if (netWorth && !incomeMissing && ahead.length > 0)
    detail = t.detailWorth(
      euro(netWorth.start),
      euro(netWorth.end),
      monthName(ahead[ahead.length - 1].month),
      inThePlus,
      ahead.length,
    );

  const notes = [t.noteEstimate];
  if (hasBalance) notes.push(t.noteBalance);
  const planned = f.months.reduce((s, m) => s + m.setAside.planned, 0);
  const lastPlanned = f.months.filter((m) => m.setAside.planned > 0).at(-1);
  if (lastPlanned) notes.push(t.noteSetAside(euro(planned), monthName(lastPlanned.month)));
  for (const o of f.missed.slice(0, 3)) notes.push(t.noteMissed(o.name, dayLabel(o.expectedDate)));

  return {
    hasForecast: ahead.length > 0,
    netWorth,
    hasBalance,
    points,
    dipMonths,
    ahead: ahead.length,
    inThePlus,
    share: incomeMissing ? 0 : share,
    growth,
    incomeMissing,
    tone,
    mood: moodForTone(tone),
    sentence,
    detail,
    notes,
    lowConfidence: f.variableBasis.lowConfidence
      ? f.variableBasis.months.length === 0
        ? t.noHistory
        : t.shortHistory(f.variableBasis.months.length, f.variableBasis.history)
      : null,
  };
}
