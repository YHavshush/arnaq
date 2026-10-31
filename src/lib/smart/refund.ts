import { and, eq, isNotNull, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";

/** How long after a payment money from the same shop still counts as the refund of it (days). */
const REFUND_WINDOW_DAYS = 90;
/** Names people pay and get paid by for everything: money back from them says nothing about a purchase. */
const NOT_A_SHOP = new Set(["tikkie", "paypal", "bunq", "wise", "revolut", "ideal"]);

export interface Payment {
  key: string;
  date: string;
  /** Positive cents. */
  amount: number;
  categoryId: number;
}

/** The sorted payments (money out) with a shop name, to look for what a refund belongs to. */
export async function loadPayments(db: Db): Promise<Payment[]> {
  const t = schema.transactions;
  const rows = await db
    .select({ key: t.merchantKey, date: t.date, amount: t.amount, categoryId: t.categoryId })
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
  refund: { key: string | null; date: string; amount: number },
): { payment: Payment; exact: boolean } | null {
  if (!refund.key || NOT_A_SHOP.has(refund.key)) return null;
  const day = dayNumber(refund.date);
  const candidates = payments.filter(
    (p) =>
      p.key === refund.key &&
      p.amount >= refund.amount &&
      dayNumber(p.date) <= day &&
      day - dayNumber(p.date) <= REFUND_WINDOW_DAYS,
  );
  if (candidates.length === 0) return null;
  const exact = candidates.find((p) => p.amount === refund.amount);
  if (exact) return { payment: exact, exact: true };
  const latest = candidates.sort((a, b) => b.date.localeCompare(a.date))[0];
  return { payment: latest, exact: false };
}
