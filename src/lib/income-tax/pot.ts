import { btwPot, type BtwPot } from "@/lib/btw/pot";

/**
 * Both pots inside the savings account ("My BTW pot is part of my savings" and "My income tax pot is part of my
 * savings"). The BTW is covered first, the income tax from what is left:
 *
 *   btw        = btwPot(saved, BTW still to set aside)
 *   incomeTax  = btwPot(btw.savingsLeft, income tax still to set aside)
 *   savingsLeft = saved - btw.pot - incomeTax.pot   (what counts toward the savings goal)
 *
 * It only moves money between lines: the savings stay the savings, so net worth and the forecast do not change.
 */
export interface TaxPots {
  btw: BtwPot;
  incomeTax: BtwPot;
}

export function taxPots(opts: {
  saved: number;
  btw: { on: boolean; toSetAside: number };
  incomeTax: { on: boolean; toSetAside: number };
}): TaxPots {
  const btw = btwPot({ on: opts.btw.on, saved: opts.saved, toSetAside: opts.btw.toSetAside });
  const incomeTax = btwPot({
    on: opts.incomeTax.on,
    saved: btw.savingsLeft,
    toSetAside: opts.incomeTax.toSetAside,
  });
  return { btw, incomeTax };
}

/** The income tax pot shared over the open years, the oldest year first (as the pocket is): year -> cents. */
export function potByYear(
  pot: number,
  years: readonly { year: number; toSetAside: number }[],
): Map<number, number> {
  let left = Math.max(pot, 0);
  const out = new Map<number, number>();
  for (const y of years) {
    const take = Math.min(left, Math.max(y.toSetAside, 0));
    out.set(y.year, take);
    left -= take;
  }
  return out;
}
