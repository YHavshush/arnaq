import { eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { sumTransactions } from "@/lib/budget/overview";
import { quarterlyBtwPaymentIds } from "@/lib/btw/summary";
import { coveredMonths } from "@/lib/recurring/occurrences";

/**
 * Average of `total` cents over `months` months, rounded half up with integer arithmetic only:
 * q = floor((2 * total + n) / (2 * n)), computed as (a - a % b) / b so the division is exact
 * (no float rounding can creep in). No months -> 0.
 */
export function averageCents(total: number, months: number): number {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new RangeError("averageCents: total must be a non-negative integer number of cents.");
  if (!Number.isSafeInteger(months) || months < 0)
    throw new RangeError("averageCents: months must be a non-negative integer.");
  if (months === 0) return 0;
  const a = 2 * total + months;
  const b = 2 * months;
  if (!Number.isSafeInteger(a)) throw new RangeError("averageCents: total too large.");
  return (a - (a % b)) / b;
}

export interface VariableAverages {
  /** The uploaded months the averages are based on, oldest first. */
  months: string[];
  /** Expense category id -> average monthly variable spend in positive cents (every expense category). */
  byCategory: Map<number, number>;
  /** Average monthly uncategorised outgoing money, positive cents. */
  uncategorised: number;
  /** True when fewer than the requested months of history exist. */
  lowConfidence: boolean;
  reason: string | null;
}

/**
 * Average variable spend per expense category over the last `history` uploaded months before
 * `beforeMonth` (the current month is never part of its own baseline).
 *
 * Variable means: not linked to a recurring occurrence, not an internal transfer, in the
 * account currency (the sumTransactions basis with excludeMatched). Per category the net spend
 * over the window (refunds subtract) is clamped at 0, then divided by the number of months that
 * actually have an upload, so a month without data never drags the average down. Months with an
 * upload but no spending in a category do count (they are real zeros).
 *
 * The quarterly BTW payment to the tax office is left out (quarterlyBtwPaymentIds): the forecast takes the BTW off the
 * net worth line as it builds up on the client's income, so averaging the payment too would count it twice. What the
 * tax office takes every month, and other tax spending, stays in.
 *
 * Income is deliberately not averaged: projected income comes from recurring items only.
 * Uncategorised outgoing money gets its own average; uncategorised incoming money is ignored.
 */
export async function getVariableAverages(
  db: Db,
  opts: { beforeMonth: string; history: number },
): Promise<VariableAverages> {
  const months = [...(await coveredMonths(db))]
    .filter((m) => m < opts.beforeMonth)
    .sort()
    .slice(-opts.history);
  const expenseCategories = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.type, "expense"));

  const spent = new Map<number, number>(expenseCategories.map((c) => [c.id, 0]));
  let uncategorised = 0;
  if (months.length > 0) {
    const sums = await sumTransactions(db, {
      fromMonth: months[0],
      toMonth: months[months.length - 1],
      excludeMatched: true,
      excludeIds: await quarterlyBtwPaymentIds(db),
    });
    for (const month of months) {
      const s = sums.get(month);
      if (!s) continue;
      uncategorised += s.uncategorised.expense;
      for (const [id, signed] of s.byCategory) {
        if (spent.has(id)) spent.set(id, spent.get(id)! - signed);
      }
    }
  }

  const n = months.length;
  const byCategory = new Map(
    [...spent].map(([id, total]) => [id, averageCents(Math.max(0, total), n)]),
  );
  const lowConfidence = n < opts.history;
  const reason =
    n === 0
      ? "No uploaded month before the current month: variable spend is projected as 0."
      : lowConfidence
        ? `Only ${n} of ${opts.history} requested months of history are uploaded.`
        : null;
  return {
    months,
    byCategory,
    uncategorised: averageCents(uncategorised, n),
    lowConfidence,
    reason,
  };
}
