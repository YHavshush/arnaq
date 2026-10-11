/**
 * Calendar helpers on ISO strings ("YYYY-MM-DD" days, "YYYY-MM" months).
 * Pure and timezone free: arithmetic runs on UTC day numbers, never on "now".
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Earliest and latest start/end dates accepted for recurring items. */
export const MIN_ITEM_DATE = "2000-01-01";
export const MAX_ITEM_DATE = "2100-12-31";

export const isMonth = (s: unknown): s is string => typeof s === "string" && MONTH_RE.test(s);

/** A real calendar day (rejects 2026-02-30 and friends). */
export function isDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(`${m[1]}-${m[2]}`) && y > 0;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Days since the epoch, for differences between dates. */
export const dayNumber = (iso: string): number =>
  Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

export function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * 86_400_000).toISOString().slice(0, 10);
}

export const monthOf = (iso: string): string => iso.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Whole months from a to b (b - a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** The given day in a month, clamped to the month's last day (31 in February -> 28/29). */
export function clampDay(month: string, day: number): string {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}`;
}

export const maxString = (a: string, b: string): string => (a > b ? a : b);
