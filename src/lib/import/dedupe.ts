import { and, eq, gte, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays, daysBetween } from "@/lib/recurring/dates";
import type { ParsedRow } from "./types";

/** A transaction the bank dates a day or two differently in another file (started versus settled) is still the same. */
const DATE_SLACK_DAYS = 3;

export interface ExistingRow {
  date: string;
  amount: number;
  balanceAfter: number | null;
  counterparty: string | null;
}

const nameOf = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which of the incoming rows are money the database already holds, whatever file they came from.
 * A transaction is the same when its amount and the balance after it are the same (the running balance makes
 * that nearly unique) and its date is within a few days; when a balance is missing, when the date, amount and
 * shop name are the same. Each stored row absorbs at most one incoming row, so two identical coffees stay two.
 * Returns the positions (in `incoming`) of the rows that are already there.
 */
export function matchExisting(existing: ExistingRow[], incoming: ParsedRow[]): Set<number> {
  const byAmount = new Map<number, { row: ExistingRow; used: boolean }[]>();
  for (const row of existing) {
    const list = byAmount.get(row.amount) ?? [];
    list.push({ row, used: false });
    byAmount.set(row.amount, list);
  }
  const duplicates = new Set<number>();
  incoming.forEach((r, i) => {
    const candidates = byAmount.get(r.amount);
    if (!candidates) return;
    const name = nameOf(r.counterparty ?? r.description);
    const hit =
      (r.balanceAfter != null
        ? candidates.find(
            (c) =>
              !c.used &&
              c.row.balanceAfter === r.balanceAfter &&
              Math.abs(daysBetween(c.row.date, r.date)) <= DATE_SLACK_DAYS,
          )
        : undefined) ??
      candidates.find(
        (c) =>
          !c.used &&
          c.row.date === r.date &&
          nameOf(c.row.counterparty) === name &&
          (r.balanceAfter == null || c.row.balanceAfter == null),
      );
    if (hit) {
      hit.used = true;
      duplicates.add(i);
    }
  });
  return duplicates;
}

/** The incoming rows (by position) that this account already holds. */
export async function findExistingDuplicates(
  db: Db,
  accountId: number,
  incoming: ParsedRow[],
): Promise<Set<number>> {
  if (incoming.length === 0) return new Set();
  const dates = incoming.map((r) => r.date).sort();
  const stored = await db
    .select({
      date: schema.transactions.date,
      amount: schema.transactions.amount,
      balanceAfter: schema.transactions.balanceAfter,
      counterparty: schema.transactions.counterparty,
    })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.accountId, accountId),
        gte(schema.transactions.date, addDays(dates[0], -DATE_SLACK_DAYS)),
        lte(schema.transactions.date, addDays(dates[dates.length - 1], DATE_SLACK_DAYS)),
      ),
    );
  return matchExisting(stored, incoming);
}
