import { daysInMonth } from "@/lib/recurring/dates";
import { buildFixedFlow } from "@/lib/view/fixed-flow";

/** The lowest end-of-day balance of the checking accounts in a month (cents), and the day it happens. */
export interface MonthLow {
  amount: number;
  /** YYYY-MM-DD */
  date: string;
}

/** A fixed item that moves money on a day: positive cents, the type says which way. */
export interface FixedMove {
  type: "income" | "expense";
  amount: number;
  date: string;
  name: string;
}

const pad = (day: number) => String(day).padStart(2, "0");

/**
 * End-of-day balances of the checking accounts for the days `fromDay`..end of `month` (index 0 is `fromDay`).
 *
 * Starts from `start` (the balance the days build on: the end of the month before, or for the current month the real
 * balance today, which already holds today's real payments), moves each fixed item on its day (one dated before
 * `fromDay` is still to come, so it moves on `fromDay`; one dated after the month, such as a 31st kept in a short
 * month, moves on the last day) and spreads `variable` evenly over the days: the running total is rounded per day,
 * so it adds up to `variable` to the cent and the last day ends on start + income - costs - variable.
 *
 * The fixed items run through buildFixedFlow (the Fixed page's day-by-day balance); only its end-of-day series is used.
 */
export function simulateDays(input: {
  month: string;
  start: number;
  /** First day to simulate (1 when omitted). */
  fromDay?: number;
  moves: FixedMove[];
  /** Everyday spending still to come over these days, cents. */
  variable: number;
}): number[] {
  const days = daysInMonth(input.month);
  const from = Math.min(Math.max(input.fromDay ?? 1, 1), days);
  const first = `${input.month}-${pad(from)}`;
  const last = `${input.month}-${pad(days)}`;
  const flow = buildFixedFlow({
    month: input.month,
    opening: input.start,
    rows: input.moves.map((m) => ({
      type: m.type,
      status: "expected" as const,
      amount: m.amount,
      name: m.name,
      date: m.date < first ? first : m.date > last ? last : m.date,
    })),
  });
  const count = days - from + 1;
  return flow.series
    .slice(from - 1)
    .map((balance, i) => balance - Math.round((input.variable * (i + 1)) / count));
}

/** The lowest of `series` (index 0 is day `firstDay` of `month`), the first such day on a tie; null without days. */
export function lowestDay(month: string, firstDay: number, series: number[]): MonthLow | null {
  let best = -1;
  for (let i = 0; i < series.length; i++) if (best < 0 || series[i] < series[best]) best = i;
  return best < 0 ? null : { amount: series[best], date: `${month}-${pad(firstDay + best)}` };
}
