import { and, desc, eq, gte, notExists } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addMonths } from "@/lib/recurring/dates";

export interface LinkableTransaction {
  /** The latest transaction of this kind. */
  id: number;
  date: string;
  /** Signed cents: money out is negative. */
  amount: number;
  counterparty: string | null;
  description: string | null;
  categoryId: number | null;
  /** How many transactions with this name and amount there are (a monthly payment shows once). */
  count: number;
}

const MAX_SHOWN = 150;

/**
 * Transactions a fixed item could be built from, for the add form: the last year, in the account's own currency,
 * not a transfer between own accounts and not yet matched to a fixed item. The same name and amount shows once.
 */
export async function listLinkableTransactions(
  db: Db,
  opts: { today: string },
): Promise<LinkableTransaction[]> {
  const t = schema.transactions;
  const since = `${addMonths(opts.today.slice(0, 7), -12)}-01`;
  const rows = await db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterparty: t.counterparty,
      description: t.description,
      categoryId: t.categoryId,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(
      and(
        gte(t.date, since),
        eq(t.isInternalTransfer, false),
        eq(t.currency, schema.accounts.currency),
        notExists(
          db
            .select({ one: schema.recurringOccurrences.id })
            .from(schema.recurringOccurrences)
            .where(eq(schema.recurringOccurrences.transactionId, t.id)),
        ),
      ),
    )
    .orderBy(desc(t.date), desc(t.id));
  const groups = new Map<string, LinkableTransaction>();
  for (const r of rows) {
    const name = (r.counterparty ?? r.description ?? "").trim().toLowerCase();
    if (!name) continue;
    const key = `${name}|${r.amount}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { ...r, count: 1 });
  }
  return [...groups.values()].slice(0, MAX_SHOWN);
}
