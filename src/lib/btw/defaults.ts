/**
 * The client a new person starts with (and the one every existing person got when the client list replaced the single
 * client, migration 0013), and the word that marks moves to the BTW pocket, until the person changes them.
 */
export const DEFAULT_BTW_INCOME_MATCH = "Featurn";
export const DEFAULT_BTW_POCKET_MATCH = "BTW";

/**
 * How many months after an invoice the client usually pays it. BTW is owed on the invoice date, so with a lag of L the
 * money that arrives in month M belongs to the BTW quarter of month M - L (see btwQuarterOfReceipt).
 */
export const BTW_PAYMENT_LAGS = [0, 1, 2] as const;
export type BtwPaymentLag = (typeof BTW_PAYMENT_LAGS)[number];
/** No lag: the money counts for the quarter it arrives in (how arnaq always worked). */
export const DEFAULT_BTW_PAYMENT_LAG: BtwPaymentLag = 0;

/** At most this many BTW clients per person. */
export const MAX_BTW_CLIENTS = 20;

export function isBtwPaymentLag(v: unknown): v is BtwPaymentLag {
  return (BTW_PAYMENT_LAGS as readonly unknown[]).includes(v);
}
