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
  /** Take the colour of this other part (the BTW pot line takes the colour of the savings it is part of). */
  slotOf?: string;
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
): WorthPart[] {
  const raw = [
    ...w.accounts.map((a) => ({
      key: `a${a.accountId}`,
      name: BANK[a.bank] ?? a.name,
      amount: a.balance,
    })),
    ...(w.savings.saved !== 0
      ? [{ key: "savings", name: savingsName, amount: w.savings.saved }]
      : []),
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
}

/**
 * Every line under the ring on Ahead, in order: the accounts, the savings, and the BTW.
 *
 * - Setting off (or no pot): the BTW is one line, the pocket minus what is still owed (`btw.net`), with no arc.
 * - With a BTW pot inside the savings (see btwPot): the savings line shows what is left after the pot and the pot is
 *   the line right after it, in the savings' colour. The ring is the same as without a pot: the pot has no arc of its
 *   own (it is part of the savings arc), and there is no BTW line, because the pot is where the BTW money is.
 *
 * The pot is shown but it is owed, so it is not the person's money: the other lines add up to net worth (the centre of
 * the ring) with the setting on or off.
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
  const parts = netWorthParts(w, n.savingsName);
  const pot = w.btwPot.pot;
  if (pot <= 0) {
    return [
      ...parts,
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
  const withPot = parts.flatMap((p) =>
    p.key === "savings"
      ? [
          { ...p, amount: p.amount - pot },
          { key: "btwPot", name: n.btwPot, amount: pot, share: 0, slotOf: "savings" },
        ]
      : [p],
  );
  // Only when the pot cannot cover it all: what is still owed is a line again, so the lines add up to the centre.
  const short = w.btwPot.short;
  return short > 0
    ? [...withPot, { key: "btw", name: n.btwOwed, amount: -short, share: 0 }]
    : withPot;
}
