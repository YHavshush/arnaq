import type { Db } from "@/db";
import { btwOfIncome } from "@/lib/btw/rate";
import { clientIncomeByMonth, type ClientIncomePart } from "@/lib/btw/share";
import { incomeTaxOf } from "./rate";
import { loadIncomeTax, rateFor, type IncomeTaxState } from "./state";

/**
 * The base of the income tax reserve: client income without the BTW inside it (BtwShare.income - BtwShare.share), for
 * the same clients and by the same received-versus-expected rules as the BTW (clientIncomeByMonth). A 0% client (for
 * example one abroad) has no BTW inside its money, so all of it counts.
 */
export function incomeTaxBase(parts: readonly ClientIncomePart[]): number {
  return parts.reduce((s, p) => s + p.amount, 0) - btwOfIncome(parts);
}

export interface IncomeTaxShare {
  /** Client income without BTW in the month (received and still expected, as the BTW share counts it), cents. */
  base: number;
  /** The rate of the month's tax year (basis points); 0 without one. */
  rate: number;
  /** base x rate, in whole cents: what to move into the income tax pocket this month. */
  share: number;
}

/**
 * The income tax to set aside for a month: the month's base at the rate of its tax year. Nothing when the reserve is not
 * active or the year has no rate. On Today it sits next to the BTW share in the taxes category.
 */
export async function incomeTaxShareForMonth(
  db: Db,
  opts: { month: string; today: string; state?: IncomeTaxState },
): Promise<IncomeTaxShare> {
  const state = opts.state ?? (await loadIncomeTax(db));
  const rate = state.active ? rateFor(state, Number(opts.month.slice(0, 4))) : 0;
  if (rate === 0) return { base: 0, rate: 0, share: 0 };
  const income = (
    await clientIncomeByMonth(db, { from: opts.month, to: opts.month, today: opts.today })
  ).get(opts.month);
  const base = income ? incomeTaxBase([...income.received, ...income.expected]) : 0;
  return { base, rate, share: incomeTaxOf(base, rate) };
}
