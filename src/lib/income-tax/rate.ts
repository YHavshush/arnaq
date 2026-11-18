/**
 * The income tax reserve rate: what the person's adviser says to keep apart, as a share of the client income without
 * BTW. Stored in basis points (490 = 4.9%), so it is a whole number like every amount in arnaq. arnaq does no tax maths:
 * no brackets, no heffingskortingen, no suggested rate.
 */

/** The highest rate that can be typed: 60%. */
export const MAX_INCOME_TAX_RATE = 6000;
/** The tax years that can be typed. */
export const MIN_TAX_YEAR = 2000;
export const MAX_TAX_YEAR = 2100;
/** At most this many tax years per person. */
export const MAX_INCOME_TAX_YEARS = 20;
/** The word that marks moves to the income tax pocket, until the person changes it. */
export const DEFAULT_INCOME_TAX_POCKET_MATCH = "Inkomstenbelasting";

export function isIncomeTaxRate(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_INCOME_TAX_RATE;
}

export function isTaxYear(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= MIN_TAX_YEAR && (v as number) <= MAX_TAX_YEAR;
}

/** The reserve on a base (cents) at a rate (basis points), in whole cents. Nothing on a base of zero or less. */
export function incomeTaxOf(base: number, rate: number): number {
  if (base <= 0 || rate <= 0) return 0;
  return Math.round((base * rate) / 10000);
}

/**
 * A rate as typed in percent ("4,9", "4.9", "6", " 4,25 ") in basis points, or null when it is not a number with at most
 * two decimals. The range is checked where the rate is stored.
 */
export function parseRatePercent(text: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** A rate in basis points as a percent without trailing zeros, with the locale's decimal sign: 490 -> "4.9" or "4,9". */
export function formatRatePercent(rate: number, locale: "en" | "nl"): string {
  const whole = Math.floor(rate / 100);
  const decimals = String(rate % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return decimals === "" ? String(whole) : `${whole}${locale === "nl" ? "," : "."}${decimals}`;
}
