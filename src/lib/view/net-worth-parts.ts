import { BANK_NAMES } from "@/lib/import/banks";

/** One part of net worth: a checking account, or the savings. */
export interface WorthPart {
  key: string;
  name: string;
  /** Cents; may be negative (an account in the red). */
  amount: number;
  /** 0..1 of the money that is above zero: how wide its part of the bar is. */
  share: number;
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
