/** Words in a bank's description that mark money coming back from a payment, not new income. */
const REVERSAL = /terugboeking|storno|refund|restitutie|terugbetaling|retour/i;

/** True when money in is a payment coming back (a bounced direct debit, a refund) rather than new income. */
export const isReversal = (description: string | null | undefined) =>
  REVERSAL.test(description ?? "");
