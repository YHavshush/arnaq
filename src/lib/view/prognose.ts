import type { Mood, Tone } from "@/design/tokens";
import type { Forecast, MonthKind } from "@/lib/forecast/forecast";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { formatter } from "./format";
import { moodForTone } from "./status";
import type { Sentence } from "@/i18n/types";

export interface PrognosePoint {
  month: string;
  label: string;
  kind: MonthKind;
  income: number;
  expenses: number;
  net: number;
  /** Net worth at the end of this month (accounts plus savings) when balances are known, else the growth since the first month (cents). */
  cumulative: number;
  /** The part of `cumulative` in the accounts and the part saved (cents); both 0 when no balances are known. */
  accounts: number;
  savings: number;
  /** Money moved into savings this month (cents): not spending, but no longer in the current account. */
  setAside: number;
  /** Month is not (fully) real money yet: drawn dashed. */
  projected: boolean;
}

export interface Prognose {
  hasForecast: boolean;
  /** `cumulative` is a real balance (the person's money), not just growth since the first month. */
  hasBalance: boolean;
  points: PrognosePoint[];
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
export function buildPrognose(f: Forecast, locale: Locale): Prognose {
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
    // Money moved into savings leaves the accounts and arrives in savings: net worth only follows income and spending.
    cumulative: m.cumulativeNet + (f.openingBalance ?? 0) + (f.openingSavings ?? 0),
    accounts: hasBalance ? m.cumulativeNet - m.cumulativeSetAside + (f.openingBalance ?? 0) : 0,
    savings: hasBalance ? m.cumulativeSetAside + (f.openingSavings ?? 0) : 0,
    setAside: m.setAside.total,
    projected: m.kind === "forecast" || m.kind === "mixed",
  }));
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

  const notes = [t.noteEstimate];
  if (hasBalance) notes.push(t.noteBalance);
  const planned = f.months.reduce((s, m) => s + m.setAside.planned, 0);
  const lastPlanned = f.months.filter((m) => m.setAside.planned > 0).at(-1);
  if (lastPlanned) notes.push(t.noteSetAside(euro(planned), monthName(lastPlanned.month)));
  for (const o of f.missed.slice(0, 3)) notes.push(t.noteMissed(o.name, dayLabel(o.expectedDate)));

  return {
    hasForecast: ahead.length > 0,
    hasBalance,
    points,
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
