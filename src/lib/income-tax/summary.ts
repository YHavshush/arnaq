import type { Db } from "@/db";
import { clientIncomeByMonth } from "@/lib/btw/share";
import { getIncomeTaxPayments, type IncomeTaxPayment } from "./payments";
import { incomeTaxOf } from "./rate";
import { incomeTaxBase } from "./share";
import { incomeTaxPocketMoves, loadIncomeTax, type IncomeTaxState } from "./state";

export interface IncomeTaxYearSummary {
  year: number;
  /** Basis points. */
  rate: number;
  /** "estimate": the rate on the client income; "known": the amount from the aanslag is typed. */
  mode: "estimate" | "known";
  /** Client income without BTW in the year (cents): received so far, and the fixed income items still expected. */
  base: { received: number; expected: number };
  /** The rate on what was received so far: what should be set aside by now (cents). */
  soFar: number;
  /** Estimate mode: the rate on received plus expected for the whole year. Known mode: the known amount (cents). */
  expected: number;
  known: number | null;
  /** What was paid to the tax office as income tax for this year (incomeTaxPaymentYear), cents. */
  paid: number;
  payments: IncomeTaxPayment[];
  /**
   * What is owed for the year now (cents, never below 0): estimate mode `soFar - paid` (the year is still running), known
   * mode `known - paid`. This is what net worth takes off.
   */
  owed: number;
  /** The part of the income tax pocket counted for this year: the pocket covers the oldest year first (cents). */
  pocket: number;
  /** What is still missing from the pocket for this year: owed - pocket (cents; 0 when covered). */
  toSetAside: number;
}

export interface IncomeTaxSummary {
  /** The reserve is on and has a tax year that counts (see loadIncomeTax). False: everything below is empty or 0. */
  active: boolean;
  /** Cents in the income tax pocket now: moved in minus moved out, all time. */
  pocket: number;
  /**
   * The years to show, oldest first: every tax year up to the current calendar year that is not paid yet (a known
   * amount paid in full closes a year; an estimate stays open until the known amount is typed). Last year in known mode
   * and this year in estimate mode can both be here.
   */
  years: IncomeTaxYearSummary[];
  /** Sum of the years' owed. */
  owed: number;
  /** Sum of the years' toSetAside: what the pocket does not cover yet. */
  toSetAside: number;
}

const EMPTY: IncomeTaxSummary = { active: false, pocket: 0, years: [], owed: 0, toSetAside: 0 };

/**
 * The income tax reserve per tax year, from the statements, the rates typed and the known amounts: what should be set
 * aside so far, what the year is expected to come to, what is in the pocket and what is still missing. `state` replaces
 * what is stored (one read for callers that already have it).
 */
export async function getIncomeTaxSummary(
  db: Db,
  opts: { today: string; state?: IncomeTaxState },
): Promise<IncomeTaxSummary> {
  const state = opts.state ?? (await loadIncomeTax(db));
  if (!state.active) return EMPTY;
  const current = Number(opts.today.slice(0, 4));
  const payments = await getIncomeTaxPayments(db, true);
  const pocket = await incomeTaxPocketMoves(db, state);
  const candidates = state.years.filter((y) => y.year <= current);

  const income =
    candidates.length > 0
      ? await clientIncomeByMonth(db, {
          from: `${candidates[0].year}-01`,
          to: `${current}-12`,
          today: opts.today,
        })
      : new Map();

  const years: IncomeTaxYearSummary[] = [];
  for (const y of candidates) {
    let received = 0;
    let all = 0;
    for (const [month, m] of income)
      if (Number(month.slice(0, 4)) === y.year) {
        received += incomeTaxBase(m.received);
        all += incomeTaxBase([...m.received, ...m.expected]);
      }
    const mine = payments.filter((p) => p.year === y.year);
    const paid = mine.reduce((s, p) => s + p.amount, 0);
    const mode = y.knownAmount !== null ? "known" : "estimate";
    // A known amount paid in full closes the year.
    if (y.knownAmount !== null && paid >= y.knownAmount) continue;
    const soFar = incomeTaxOf(received, y.rate);
    years.push({
      year: y.year,
      rate: y.rate,
      mode,
      base: { received, expected: all - received },
      soFar,
      expected: y.knownAmount ?? incomeTaxOf(all, y.rate),
      known: y.knownAmount,
      paid,
      payments: mine,
      owed: Math.max((y.knownAmount ?? soFar) - paid, 0),
      pocket: 0,
      toSetAside: 0,
    });
  }

  // The pocket covers the oldest year first: last year's bill comes before this year's.
  let left = Math.max(pocket, 0);
  for (const y of years) {
    y.pocket = Math.min(left, y.owed);
    left -= y.pocket;
    y.toSetAside = y.owed - y.pocket;
  }
  return {
    active: true,
    pocket,
    years,
    owed: years.reduce((s, y) => s + y.owed, 0),
    toSetAside: years.reduce((s, y) => s + y.toSetAside, 0),
  };
}

/**
 * What the income tax adds to net worth now: the pocket (real money, left out of savings) minus what is owed for the
 * open years. Negative while the pocket is short; 0 when the reserve is not active. The net worth card and the
 * forecast's net worth line both use this, so they agree.
 */
export function incomeTaxNetWorth(s: Pick<IncomeTaxSummary, "active" | "pocket" | "owed">): number {
  return s.active ? s.pocket - s.owed : 0;
}
