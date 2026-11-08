import type { BtwPot } from "@/lib/btw/pot";
import { BANK_NAMES } from "@/lib/import/banks";

/** One part of net worth: a checking account, or the savings. */
export interface WorthPart {
  key: string;
  name: string;
  /** Cents; may be negative (an account in the red). */
  amount: number;
  /** 0..1 of the money that is above zero: how wide its part of the bar is. */
  share: number;
  /** Take the colour of this other part (the BTW line takes the colour of the BTW pot). */
  slotOf?: string;
  /** Words shown instead of the amount ("covered by your pot"). */
  text?: string;
}

const BANK: Record<string, string> = BANK_NAMES;

/**
 * The parts of net worth for the bar on Ahead: each account with a stated balance, then the savings. A part at or
 * below zero keeps its amount but has no width, so the bar always adds up to the money that exists.
 */
export function netWorthParts(
  w: {
    accounts: { accountId: number; bank: string; name: string; balance: number }[];
    savings: { saved: number };
  },
  savingsName: string,
  pot?: { amount: number; name: string },
): WorthPart[] {
  // With a BTW pot inside the savings, the savings line holds what is left and the pot follows it.
  const potCents = pot && pot.amount > 0 ? pot.amount : 0;
  const raw = [
    ...w.accounts.map((a) => ({
      key: `a${a.accountId}`,
      name: BANK[a.bank] ?? a.name,
      amount: a.balance,
    })),
    ...(w.savings.saved !== 0
      ? [{ key: "savings", name: savingsName, amount: w.savings.saved - potCents }]
      : []),
    ...(pot && potCents > 0 ? [{ key: "btwPot", name: pot.name, amount: potCents }] : []),
  ];
  const positive = raw.reduce((s, p) => s + Math.max(p.amount, 0), 0);
  return raw.map((p) => ({ ...p, share: positive > 0 ? Math.max(p.amount, 0) / positive : 0 }));
}

/** The words aheadWorthParts needs (t.ui.netWorth). */
export interface WorthNames {
  savingsName: string;
  btwOwed: string;
  btwSpare: string;
  btwPot: string;
  btwShort: string;
  btwCovered: string;
}

/**
 * Every line under the ring on Ahead, in order: the accounts, the savings, and the BTW.
 *
 * - Setting off (or no pot): the BTW is one line, the pocket minus what is still owed (`btw.net`), with no arc.
 * - With a BTW pot inside the savings (see btwPot): the savings line holds what is left, the pot is its own line and
 *   arc, and the BTW line is what the pot does not cover: "covered by your pot", or the amount still short. The BTW
 *   line takes the pot's colour.
 *
 * The pot is shown but it is owed, so it is not the person's money: the other lines add up to net worth (the centre of
 * the ring) with the setting on or off, and the arcs still fill the circle with the same money (the savings arc
 * shrinks by the pot's arc).
 */
export function aheadWorthParts(
  w: {
    accounts: { accountId: number; bank: string; name: string; balance: number }[];
    savings: { saved: number };
    btw: { net: number };
    btwPot: BtwPot;
  },
  n: WorthNames,
): WorthPart[] {
  const pot = w.btwPot.pot;
  if (pot <= 0) {
    return [
      ...netWorthParts(w, n.savingsName),
      ...(w.btw.net !== 0
        ? [
            {
              key: "btw",
              name: w.btw.net < 0 ? n.btwOwed : n.btwSpare,
              amount: w.btw.net,
              share: 0,
            },
          ]
        : []),
    ];
  }
  const short = w.btwPot.short;
  return [
    ...netWorthParts(w, n.savingsName, { amount: pot, name: n.btwPot }),
    short > 0
      ? { key: "btw", name: n.btwShort, amount: -short, share: 0, slotOf: "btwPot" }
      : { key: "btw", name: n.btwOwed, amount: 0, share: 0, slotOf: "btwPot", text: n.btwCovered },
  ];
}
