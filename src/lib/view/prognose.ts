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
  /** Running sum over the shown months (cents). */
  cumulative: number;
  /** Month is not (fully) real money yet: drawn dashed. */
  projected: boolean;
}

export interface Prognose {
  hasForecast: boolean;
  points: PrognosePoint[];
  /** Months ahead (current month included) and how many of them end in the plus. */
  ahead: number;
  inThePlus: number;
  /** Ring fill: share of those months that end in the plus. */
  share: number;
  /** Net growth from the current month to the last forecast month, cents. */
  growth: number;
  tone: Tone;
  mood: Mood;
  sentence: Sentence;
  lowConfidence: string | null;
}

/** Pure view model for the Prognose screen from a Forecast. */
export function buildPrognose(f: Forecast, locale: Locale): Prognose {
  const t = messages[locale].view.prognose;
  const { euroSigned, monthName, monthShort } = formatter(locale);
  const points: PrognosePoint[] = f.months.map((m) => ({
    month: m.month,
    label: monthShort(m.month),
    kind: m.kind,
    income: m.income,
    expenses: m.expenses,
    net: m.net,
    cumulative: m.cumulativeNet,
    projected: m.kind === "forecast" || m.kind === "mixed",
  }));
  // With no data at all every month nets to 0: that is "nothing to say", not "all in the plus".
  const hasData = points.some((p) => p.income !== 0 || p.expenses !== 0);
  const ahead = hasData ? points.filter((p) => p.projected) : [];
  const inThePlus = ahead.filter((p) => p.net >= 0).length;
  const growth = ahead.reduce((s, p) => s + p.net, 0);
  const share = ahead.length === 0 ? 0 : inThePlus / ahead.length;

  const tone: Tone =
    ahead.length === 0 ? "accent" : share === 1 ? "good" : growth >= 0 ? "warn" : "bad";

  let sentence: Sentence = [{ text: t.nothing }];
  if (ahead.length > 0) {
    const sorted = [...ahead].sort((a, b) => a.net - b.net);
    const tight = sorted[0];
    const best = sorted[sorted.length - 1];
    sentence =
      tight.month === best.month
        ? t.single(monthName(tight.month), euroSigned(tight.net))
        : t.range(
            monthName(tight.month),
            euroSigned(tight.net),
            monthName(best.month),
            euroSigned(best.net),
          );
  }

  return {
    hasForecast: ahead.length > 0,
    points,
    ahead: ahead.length,
    inThePlus,
    share,
    growth,
    tone,
    mood: moodForTone(tone),
    sentence,
    lowConfidence: f.variableBasis.lowConfidence
      ? f.variableBasis.months.length === 0
        ? t.noHistory
        : t.shortHistory(f.variableBasis.months.length, f.variableBasis.history)
      : null,
  };
}
