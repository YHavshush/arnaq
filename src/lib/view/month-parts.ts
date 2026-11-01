import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import type { ForecastMonth, ForecastPart } from "@/lib/forecast/forecast";
import { formatter } from "./format";

/** One line under the Income or Expenses tile of a month. */
export interface PartLine {
  key: string;
  label: string;
  /** "4 items", for a line that bundles several; null for a single one. */
  count: string | null;
  /** Cents; the lines of a month add up to its total exactly. */
  amount: number;
  /** amount / total, 0 to 1: the length of the bar. */
  share: number;
  /** Planned or happened: "expected", "received", "paid", "3 of 4 paid", "your averages". */
  tag: string | null;
  /** Muted line under it: the names that make it up. */
  sub: string | null;
  /** Which chart colour the bar and dot use (1 to 3). */
  tone: 1 | 2 | 3;
}

export interface MonthParts {
  lines: PartLine[];
  /** Equals the Income or Expenses tile (cents). */
  total: number;
  /** Money that is not in the total but may be asked about: what was set aside this month. */
  note: string | null;
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const tone = (i: number) => ((i % 3) + 1) as 1 | 2 | 3;

function share(amount: number, total: number): number {
  return total > 0 ? Math.min(Math.max(amount / total, 0), 1) : 0;
}

/**
 * Where a month's income comes from: one line per fixed income item (expected or received), then whatever
 * else came in (real money that is not a fixed item). The lines add up to `m.income`.
 */
export function incomeParts(m: ForecastMonth, locale: Locale): MonthParts {
  const t = messages[locale].view.prognose.parts;
  const total = m.income;
  const lines: PartLine[] = m.parts.income.map((p, i) => ({
    key: `income-${i}`,
    label: p.name,
    count: null,
    amount: p.amount,
    share: share(p.amount, total),
    tag: p.settled ? t.received : t.expected,
    sub: null,
    tone: tone(i),
  }));
  const other = total - sum(m.parts.income);
  if (other !== 0)
    lines.push({
      key: "income-other",
      label: t.otherIncome,
      count: null,
      amount: other,
      share: share(other, total),
      tag: t.received,
      sub: null,
      tone: tone(lines.length),
    });
  return { lines, total, note: null };
}

/** The tag of a bundle: all expected, all done, or how many are done. */
function bundleTag(
  parts: ForecastPart[],
  t: (typeof messages)[Locale]["view"]["prognose"]["parts"],
  euro: (cents: number) => string,
): string {
  const settled = parts.filter((p) => p.settled);
  if (settled.length === 0) return t.expected;
  if (settled.length === parts.length) return t.paid;
  return t.partlyPaid(euro(sum(settled)), euro(sum(parts)));
}

/** "Rent €481 · Health insurance €151 · 2 more": the biggest first, at most three named. */
function names(
  entries: { name: string; amount: number }[],
  t: (typeof messages)[Locale]["view"]["prognose"]["parts"],
  euro: (cents: number) => string,
): string | null {
  const sorted = [...entries].sort((a, b) => b.amount - a.amount);
  if (sorted.length === 0) return null;
  const shown = sorted.slice(0, 3).map((e) => `${e.name} ${euro(e.amount)}`);
  const rest = sorted.length - 3;
  return [...shown, ...(rest > 0 ? [t.more(rest)] : [])].join(" · ");
}

/**
 * Where a month's spending goes: fixed costs (items named), everyday spending (what is left of the total: the
 * averages for a month ahead, real spending for one that has happened), and a note about money set aside. The
 * lines add up to `m.expenses`, which does not include money set aside.
 */
export function expenseParts(m: ForecastMonth, locale: Locale): MonthParts {
  const t = messages[locale].view.prognose.parts;
  const { euro } = formatter(locale);
  const total = m.expenses;
  const fixed = m.parts.fixed;
  const fixedTotal = sum(fixed);
  const everyday = total - fixedTotal;
  const lines: PartLine[] = [];

  if (fixed.length > 0)
    lines.push({
      key: "fixed",
      label: t.fixedCosts,
      count: t.items(fixed.length),
      amount: fixedTotal,
      share: share(fixedTotal, total),
      tag: bundleTag(fixed, t, euro),
      sub: names(fixed, t, euro),
      tone: 1,
    });

  if (everyday !== 0) {
    // Per category, what is not a fixed item: the same split as the total.
    const unsorted = messages[locale].view.overzicht.uncategorised;
    const byCategory = m.categories
      .map((c) => ({
        name: c.categoryId === null ? unsorted : c.name,
        amount: c.total - sum(fixed.filter((p) => p.categoryId === c.categoryId)),
      }))
      .filter((c) => c.amount > 0);
    lines.push({
      key: "everyday",
      label: t.everyday,
      count: null,
      amount: everyday,
      share: share(everyday, total),
      tag:
        m.kind === "forecast" ? t.basisAverages : m.kind === "mixed" ? t.basisMixed : t.basisActual,
      sub: names(byCategory, t, euro),
      tone: 2,
    });
  }

  return {
    lines,
    total,
    note: m.setAside.total > 0 ? t.setAsideNote(euro(m.setAside.total)) : null,
  };
}
