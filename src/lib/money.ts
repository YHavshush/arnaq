/**
 * Money is integer cents everywhere. Amounts are parsed from strings with
 * integer arithmetic only, so no float rounding can creep in.
 */
export function parseAmountToCents(input: string, decimalSeparator: "," | "."): number {
  const thousands = decimalSeparator === "," ? "." : ",";
  const cleaned = input.trim().replaceAll(thousands, "").replaceAll(/\s/g, "");
  const match = /^([+-])?(\d*)(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match || (match[2] === "" && match[3] === undefined)) {
    throw new Error(`Invalid amount: "${input}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(cents / 100);
}
