// Display formatting. Money is integer cents everywhere else; this is the only place it becomes text.
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import { daysInMonth } from "@/lib/recurring/dates";

const NBSP = " ";

export interface Formatter {
  /** Whole euros, e.g. "€ 1.234" (nl) or "€1,234" (en). Rounds half away from zero on the cents. */
  euro(cents: number): string;
  /** Euros with cents. */
  euroExact(cents: number): string;
  /** "+ € 120" / "− € 120": for growth and differences. */
  euroSigned(cents: number): string;
  /** "2026-10" -> "oktober 2026" / "October 2026" */
  monthName(month: string): string;
  /** "2026-10" -> "okt" / "Oct" */
  monthShort(month: string): string;
  /** "2026-10-25" -> "25 okt" / "25 Oct" */
  dayLabel(date: string): string;
}

const cache = new Map<Locale, Formatter>();

/** Formatting for one language. Cached: building Intl formatters is not free. */
export function formatter(locale: Locale): Formatter {
  const hit = cache.get(locale);
  if (hit) return hit;
  const tag = INTL_LOCALE[locale];
  const whole = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const long = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" });
  const at = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d ?? 1));
  };
  const trim = (s: string) => s.replace(/\.$/, "");
  const sep = locale === "nl" ? NBSP : "";

  const f: Formatter = {
    euro(cents) {
      const rounded = Math.sign(cents) * Math.round(Math.abs(cents) / 100);
      return `${rounded < 0 ? "-" : ""}€${sep}${whole.format(Math.abs(rounded))}`;
    },
    euroExact(cents) {
      return `${cents < 0 ? "-" : ""}€${sep}${exact.format(Math.abs(cents) / 100)}`;
    },
    euroSigned(cents) {
      if (cents === 0) return f.euro(0);
      return `${cents > 0 ? "+" : "−"}${NBSP}${f.euro(Math.abs(cents))}`;
    },
    monthName: (month) => long.format(at(`${month}-01`)),
    monthShort: (month) => trim(short.format(at(`${month}-01`))),
    dayLabel: (date) => `${Number(date.slice(8, 10))} ${trim(short.format(at(date)))}`,
  };
  cache.set(locale, f);
  return f;
}

/** Share of the month that has passed on `today`: 0 before it, 1 after it. */
export function monthProgress(month: string, today: string): number {
  const todayMonth = today.slice(0, 7);
  if (todayMonth > month) return 1;
  if (todayMonth < month) return 0;
  return Number(today.slice(8, 10)) / daysInMonth(month);
}
