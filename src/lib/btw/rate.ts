/**
 * The BTW inside money a client paid. A client on the standard rate pays the price plus 21% BTW, so the BTW is 21 parts
 * of every 121 received. A client charged no BTW (0%, for example a business client in another EU country, where the
 * BTW is reverse-charged) adds nothing.
 */

/** The rates a BTW client can have: the standard Dutch rate, or none charged. */
export const BTW_VAT_PERCENTS = [21, 0] as const;
export type BtwVatPercent = (typeof BTW_VAT_PERCENTS)[number];
/** The standard Dutch rate. */
export const BTW_RATE_PERCENT = 21;

export function isBtwVatPercent(v: unknown): v is BtwVatPercent {
  return (BTW_VAT_PERCENTS as readonly unknown[]).includes(v);
}

/** The BTW inside an amount paid (which includes BTW) at a rate: rate parts of every 100 + rate, in whole cents. */
export function btwInside(paid: number, vatPercent: BtwVatPercent = BTW_RATE_PERCENT): number {
  if (vatPercent === 0) return 0;
  return Math.round((paid * vatPercent) / (100 + vatPercent));
}

/**
 * The BTW inside several amounts, each with its client's rate: summed per rate and rounded once per rate. With one rate
 * this is btwInside of the total, so a single 21% client gives exactly what one total always gave.
 */
export function btwOfIncome(
  parts: readonly { amount: number; vatPercent: BtwVatPercent }[],
): number {
  const byRate = new Map<BtwVatPercent, number>();
  for (const p of parts) byRate.set(p.vatPercent, (byRate.get(p.vatPercent) ?? 0) + p.amount);
  let btw = 0;
  for (const [rate, amount] of byRate) btw += btwInside(amount, rate);
  return btw;
}
