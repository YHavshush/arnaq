import { addMonths, clampDay } from "@/lib/recurring/dates";
import type { BtwPaymentLag } from "./defaults";

/**
 * Which money belongs to which BTW quarter: the one place that decides it.
 *
 * BTW is owed per calendar quarter on the INVOICE date, and the return is due at the end of the month after the quarter.
 * That part never moves: the quarter's dates, its due date and the window in which the payment to the tax office is
 * recognised are all calendar based. What can move is the money that funds the quarter: when the client pays about L
 * months after the invoice, the money that arrives in month M was invoiced in month M - L, so it counts for the quarter
 * of M - L. With L = 1 the fourth quarter's money is what arrives from 1 November to 31 January.
 */

export interface BtwQuarter {
  /** "2026-Q3". */
  label: string;
  /** The quarter's own first and last day (calendar; the invoices dated in it). */
  from: string;
  to: string;
  /** The last day to file and pay: the end of the month after the quarter. */
  due: string;
}

export function quarterOf(year: number, q: number): BtwQuarter {
  const first = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}`;
  const last = addMonths(first, 2);
  return {
    label: `${year}-Q${q}`,
    from: `${first}-01`,
    to: clampDay(last, 31),
    due: clampDay(addMonths(last, 1), 31),
  };
}

/** The calendar quarter a day (YYYY-MM-DD) or a month (YYYY-MM) falls in. */
export function calendarQuarter(dateOrMonth: string): BtwQuarter {
  const year = Number(dateOrMonth.slice(0, 4));
  return quarterOf(year, Math.floor((Number(dateOrMonth.slice(5, 7)) - 1) / 3) + 1);
}

/** The quarter before the given one. */
export function previousQuarter(q: BtwQuarter): BtwQuarter {
  return calendarQuarter(addMonths(q.from.slice(0, 7), -3));
}

/** The quarter the card is about: the earliest one whose payment is still due today or later. Calendar based. */
export function btwQuarter(today: string): BtwQuarter {
  const current = calendarQuarter(today);
  const previous = previousQuarter(current);
  return previous.due >= today ? previous : current;
}

/**
 * The BTW quarter money from the client counts for, from the day (or month) it arrived and the payment lag: the
 * calendar quarter of the month `lag` months earlier. Money still expected (the forecast, the plan) follows the same
 * rule: its BTW is set aside in the month it arrives, for this quarter.
 */
export function btwQuarterOfReceipt(dateOrMonth: string, lag: BtwPaymentLag): BtwQuarter {
  return calendarQuarter(addMonths(dateOrMonth.slice(0, 7), -lag));
}

/**
 * The days whose money from the client funds a quarter (both ends included): the quarter moved `lag` whole months later.
 * The exact inverse of btwQuarterOfReceipt.
 */
export function btwReceiptWindow(
  quarter: Pick<BtwQuarter, "from" | "to">,
  lag: BtwPaymentLag,
): { from: string; to: string } {
  return {
    from: `${addMonths(quarter.from.slice(0, 7), lag)}-01`,
    to: clampDay(addMonths(quarter.to.slice(0, 7), lag), 31),
  };
}
