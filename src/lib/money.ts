/**
 * Money is integer cents everywhere. Amounts are parsed from strings with
 * integer arithmetic only, so no float rounding can creep in.
 */
/** Largest amount accepted anywhere, in cents (10 billion euro). Keeps sums exact and sane. */
export const MAX_CENTS = 1_000_000_000_000;

export function parseAmountToCents(input: string, decimalSeparator: "," | "."): number {
  const thousands = decimalSeparator === "," ? "." : ",";
  const cleaned = input.trim().replaceAll(thousands, "").replaceAll(/\s/g, "");
  const match = /^([+-])?(\d*)(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match || (match[2] === "" && match[3] === undefined)) {
    throw new Error(`Invalid amount: "${input}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS)
    throw new Error(`Amount out of range: "${input}"`);
  return sign === "-" ? -cents : cents;
}

export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(cents / 100);
}
