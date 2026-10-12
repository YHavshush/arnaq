// Display formatting. Money is integer cents everywhere else; this is the only place it becomes text.
import { daysInMonth } from "@/lib/recurring/dates";

const NL_MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];
const NL_SHORT = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

const whole = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Whole euros, e.g. "€ 1.234". Rounds half away from zero on the cents. */
export function euro(cents: number): string {
  const rounded = Math.sign(cents) * Math.round(Math.abs(cents) / 100);
  return `${rounded < 0 ? "-" : ""}€ ${whole.format(Math.abs(rounded))}`;
}

/** Euros with cents, e.g. "€ 1.234,56". */
export function euroExact(cents: number): string {
  return `${cents < 0 ? "-" : ""}€ ${exact.format(Math.abs(cents) / 100)}`;
}

/** "+ € 120" / "− € 120": for growth and differences. */
export function euroSigned(cents: number): string {
  if (cents === 0) return euro(0);
  return `${cents > 0 ? "+" : "−"} ${euro(Math.abs(cents))}`;
}

/** "2026-10" -> "oktober 2026" */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${NL_MONTHS[m - 1]} ${y}`;
}

/** "2026-10" -> "okt" */
export function monthShort(month: string): string {
  return NL_SHORT[Number(month.slice(5, 7)) - 1];
}

/** "2026-10-25" -> "25 okt" */
export function dayLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${NL_SHORT[Number(date.slice(5, 7)) - 1]}`;
}

/** Share of the month that has passed on `today`: 0 before it, 1 after it. */
export function monthProgress(month: string, today: string): number {
  const todayMonth = today.slice(0, 7);
  if (todayMonth > month) return 1;
  if (todayMonth < month) return 0;
  return Number(today.slice(8, 10)) / daysInMonth(month);
}
