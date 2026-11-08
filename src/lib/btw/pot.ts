/**
 * The BTW pot inside the savings account (the setting "My BTW pot is part of my savings").
 *
 * Some banks only say "To savings": nothing names the pot, so arnaq cannot see which part of the savings is BTW money.
 * With the setting on, the savings count toward the BTW first:
 *
 *   toSetAside  = what is still missing from the BTW pocket (BtwSummary.toSetAside: owed minus the pocket, 0 once paid)
 *   pot         = max(0, min(saved, toSetAside))
 *   savingsLeft = saved - pot
 *   short       = toSetAside - pot
 *
 * It only moves money between lines: savingsLeft + pot is the savings, so net worth does not change.
 */
export interface BtwPot {
  /** Cents of the savings counted as BTW money (0 with the setting off). */
  pot: number;
  /** The savings without the pot (cents; can be below zero when the savings are). */
  savingsLeft: number;
  /** What the pot (and the pocket) do not cover yet (cents; 0 when covered). */
  short: number;
}

export function btwPot({
  on,
  saved,
  toSetAside,
}: {
  on: boolean;
  saved: number;
  toSetAside: number;
}): BtwPot {
  const missing = Math.max(toSetAside, 0);
  const pot = on ? Math.max(0, Math.min(saved, missing)) : 0;
  return { pot, savingsLeft: saved - pot, short: missing - pot };
}

/** What counts toward the savings goal: the savings without the BTW pot (that money is owed, not the person's goal). */
export function goalSaved(s: { saved: number; btwPot?: number }): number {
  return s.saved - (s.btwPot ?? 0);
}
