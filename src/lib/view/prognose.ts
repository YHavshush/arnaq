import type { Mood, Tone } from "@/design/tokens";
import type { Forecast, MonthKind } from "@/lib/forecast/forecast";
import { euroSigned, monthName, monthShort } from "./format";
import { moodForTone } from "./status";
import type { Sentence } from "./overzicht";

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

const plain = (text: string) => ({ text });
const em = (text: string) => ({ text, em: true });

/** Pure view model for the Prognose screen from a Forecast. */
export function buildPrognose(f: Forecast): Prognose {
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
  const ahead = points.filter((p) => p.projected);
  const inThePlus = ahead.filter((p) => p.net >= 0).length;
  const growth = ahead.reduce((s, p) => s + p.net, 0);
  const share = ahead.length === 0 ? 0 : inThePlus / ahead.length;

  const tone: Tone =
    ahead.length === 0 ? "accent" : share === 1 ? "good" : growth >= 0 ? "warn" : "bad";

  let sentence: Sentence = [plain("Er is nog niets om te voorspellen. Upload eerst een maand.")];
  if (ahead.length > 0) {
    const sorted = [...ahead].sort((a, b) => a.net - b.net);
    const tight = sorted[0];
    const best = sorted[sorted.length - 1];
    sentence =
      tight.month === best.month
        ? [plain(`${monthName(tight.month)} sluit op `), em(euroSigned(tight.net)), plain(".")]
        : [
            plain("De krapste maand is "),
            em(monthName(tight.month)),
            plain(` (${euroSigned(tight.net)}), de beste `),
            em(monthName(best.month)),
            plain(` (${euroSigned(best.net)}).`),
          ];
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
    lowConfidence: f.variableBasis.lowConfidence ? f.variableBasis.reason : null,
  };
}
