import { daysInMonth } from "@/lib/recurring/dates";
import type { VasteLastRow } from "./vaste-lasten";

export interface FlowEvent {
  day: number;
  /** The fixed items that moved on that day, as stored. */
  names: string[];
  /** Signed cents: money out is negative. */
  amount: number;
  /** The balance at the end of that day. */
  balance: number;
}

export interface FixedFlow {
  days: number;
  /** The checking balance at the start of the month, or 0 when none is known. */
  start: number;
  /** True when `start` is a real balance from the statements, not zero. */
  startKnown: boolean;
  /** One entry per day with a fixed item, in order. */
  events: FlowEvent[];
  /** The balance at the end of each day, 1..days. */
  series: number[];
  /** The lowest the balance gets, and the day (the day-start balance counts, and costs go before income on a day). */
  lowest: { day: number; balance: number };
  end: number;
}

/**
 * The month's fixed items day by day, as a running balance of the checking accounts: what each one did to the balance
 * and where it dips lowest. Only the fixed items move it (everyday spending is not in it), so the dip is the least
 * it can be. A missed item did not move any money, so it is left out. Costs on a day are taken before income, so the
 * lowest point is the careful one.
 */
export function buildFixedFlow(input: {
  month: string;
  /** Checking balance at the start of the month (cents), or null when no statement gives one. */
  opening: number | null;
  rows: Pick<VasteLastRow, "type" | "status" | "amount" | "date" | "name">[];
}): FixedFlow {
  const days = daysInMonth(input.month);
  const start = input.opening ?? 0;
  const byDay = new Map<number, { out: number; in: number; names: string[] }>();
  for (const r of input.rows) {
    if (r.status === "missed" || !r.date.startsWith(input.month)) continue;
    const day = Math.min(Math.max(Number(r.date.slice(8, 10)), 1), days);
    const d = byDay.get(day) ?? { out: 0, in: 0, names: [] };
    d.names.push(r.name);
    if (r.type === "expense") d.out += r.amount;
    else d.in += r.amount;
    byDay.set(day, d);
  }
  const series: number[] = [];
  const events: FlowEvent[] = [];
  let balance = start;
  let lowest = { day: 1, balance: start };
  for (let day = 1; day <= days; day++) {
    const d = byDay.get(day);
    if (d) {
      balance -= d.out;
      if (balance < lowest.balance) lowest = { day, balance };
      balance += d.in;
      events.push({ day, names: d.names, amount: d.in - d.out, balance });
    }
    series.push(balance);
  }
  return {
    days,
    start,
    startKnown: input.opening !== null,
    events,
    series,
    lowest,
    end: balance,
  };
}
