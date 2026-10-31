import { and, eq, isNotNull, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";

/** How long after a payment money from the same shop still counts as the refund of it (days). */
const REFUND_WINDOW_DAYS = 90;
/** Names people pay and get paid by for everything: money back from them says nothing about a purchase. */
const NOT_A_SHOP = new Set(["tikkie", "paypal", "bunq", "wise", "revolut", "ideal"]);

/**
 * Bank apps write the direction into the name ("To Amazon Payments Europe SCA", "Payment from AMAZON MARKETPLACE"),
 * so the same shop has different keys on the way out and back. The first word of the shop is what they share.
 */
const DIRECTION = /^(payment (from|to)|betaling (van|aan)|to|from|van|aan)\s+/i;
export function shopWord(counterparty: string | null): string | null {
  const word = (counterparty ?? "")
    .toLowerCase()
    .replace(DIRECTION, "")
    .split(/[^a-z0-9]+/)
    .find((w) => w.length > 0);
  return word && word.length >= 4 && !NOT_A_SHOP.has(word) ? word : null;
}

export interface Payment {
  key: string;
  /** See shopWord. */
  shop: string | null;
  date: string;
  /** Positive cents. */
  amount: number;
  categoryId: number;
}

/** The sorted payments (money out) with a shop name, to look for what a refund belongs to. */
export async function loadPayments(db: Db): Promise<Payment[]> {
  const t = schema.transactions;
  const rows = await db
    .select({
      key: t.merchantKey,
      counterparty: t.counterparty,
      date: t.date,
      amount: t.amount,
      categoryId: t.categoryId,
    })
    .from(t)
    .where(
      and(
        lt(t.amount, 0),
        isNotNull(t.categoryId),
        isNotNull(t.merchantKey),
        eq(t.isInternalTransfer, false),
      ),
    );
  return rows.map((r) => ({
    key: r.key!,
    shop: shopWord(r.counterparty),
    date: r.date,
    amount: -r.amount,
    categoryId: r.categoryId!,
  }));
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * The payment that money in from the same shop is the refund of: paid at most REFUND_WINDOW_DAYS before and not
 * smaller than the refund. The same amount wins (a full refund), otherwise the closest earlier payment (a partial one).
 */
export function findRefundPayment(
  payments: Payment[],
  refund: { key: string | null; counterparty: string | null; date: string; amount: number },
): { payment: Payment; exact: boolean } | null {
  if (!refund.key || NOT_A_SHOP.has(refund.key)) return null;
  const day = dayNumber(refund.date);
  const shop = shopWord(refund.counterparty);
  const inTime = payments.filter(
    (p) =>
      p.amount >= refund.amount &&
      dayNumber(p.date) <= day &&
      day - dayNumber(p.date) <= REFUND_WINDOW_DAYS,
  );
  // The same name: any amount up to the payment. Only the first word in common: the same amount, to be sure.
  const candidates = inTime.filter(
    (p) => p.key === refund.key || (shop !== null && p.shop === shop && p.amount === refund.amount),
  );
  if (candidates.length === 0) return null;
  const exact = candidates.find((p) => p.amount === refund.amount);
  if (exact) return { payment: exact, exact: true };
  const latest = candidates.sort((a, b) => b.date.localeCompare(a.date))[0];
  return { payment: latest, exact: false };
}
