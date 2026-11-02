import { INTL_LOCALE, type Locale } from "@/i18n/config";

/** A formatted amount cut around its number, so the number alone can count up and the rest stays as printed. */
export interface CountTemplate {
  /** Everything before the number: a sign and the currency symbol, with their spaces. */
  before: string;
  /** Everything after the number. */
  after: string;
  /** The number the text ends on (whole units, with decimals when the text has them). */
  target: number;
  /** How many decimals the text shows. */
  decimals: number;
}

/** The first number in the text: digits with group and decimal marks between them. */
const NUMBER = /\d(?:[\d.,   ]*\d)?/;

function marks(locale: Locale) {
  const parts = new Intl.NumberFormat(INTL_LOCALE[locale]).formatToParts(1234567.5);
  return {
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    group: parts.find((p) => p.type === "group")?.value ?? ",",
  };
}

/** Cut a printed amount around its number; null when the text has no number to count. */
export function parseCount(text: string, locale: Locale): CountTemplate | null {
  const hit = NUMBER.exec(text);
  if (!hit) return null;
  const { decimal } = marks(locale);
  const raw = hit[0];
  const at = raw.lastIndexOf(decimal);
  const decimals = at === -1 ? 0 : raw.length - at - 1;
  const digits = raw.replace(/\D/g, "");
  const target = Number(digits) / 10 ** decimals;
  if (!Number.isFinite(target)) return null;
  return {
    before: text.slice(0, hit.index),
    after: text.slice(hit.index + raw.length),
    target,
    decimals,
  };
}

/** The text with its number at `fraction` (0 to 1) of the way to the target. At 1 it is exactly the printed text. */
export function countText(t: CountTemplate, fraction: number, locale: Locale): string {
  const f = Math.min(Math.max(fraction, 0), 1);
  const value = f === 1 ? t.target : Math.round(t.target * f * 10 ** t.decimals) / 10 ** t.decimals;
  const number = new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: t.decimals,
    maximumFractionDigits: t.decimals,
  }).format(value);
  return `${t.before}${number}${t.after}`;
}
