import { eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { INTERNAL_TRANSFER_CATEGORY } from "./defaults";

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Flag transfers between the user's own accounts so they stay out of income and expenses.
 *  1. A transaction whose counterparty IBAN is one of our own account IBANs.
 *  2. An outflow and an inflow on different accounts with opposite amounts, same currency,
 *     at most `maxDays` apart. Each transaction is used in at most one pair.
 * Already-flagged transactions are left alone. Returns the number of transactions flagged.
 */
export function detectInternalTransfers(db: Db, opts: { maxDays?: number } = {}): number {
  const maxDays = opts.maxDays ?? 3;
  const category = db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.name, INTERNAL_TRANSFER_CATEGORY))
    .get();
  if (!category) return 0;

  const accounts = db.select().from(schema.accounts).all();
  const ownIbans = new Set(accounts.map((a) => a.iban).filter((i): i is string => !!i));
  const open = db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.isInternalTransfer, false))
    .all();

  const flagged = new Set<number>();

  for (const t of open) {
    if (t.counterpartyIban && ownIbans.has(t.counterpartyIban)) flagged.add(t.id);
  }

  const free = (t: (typeof open)[number]) => !flagged.has(t.id);
  const outflows = open
    .filter((t) => t.amount < 0 && free(t))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const out of outflows) {
    if (!free(out)) continue;
    const match = open
      .filter(
        (t) =>
          free(t) &&
          t.amount === -out.amount &&
          t.currency === out.currency &&
          t.accountId !== out.accountId &&
          Math.abs(dayNumber(t.date) - dayNumber(out.date)) <= maxDays,
      )
      .sort(
        (a, b) =>
          Math.abs(dayNumber(a.date) - dayNumber(out.date)) -
            Math.abs(dayNumber(b.date) - dayNumber(out.date)) || a.id - b.id,
      )[0];
    if (match) {
      flagged.add(out.id);
      flagged.add(match.id);
    }
  }

  if (flagged.size === 0) return 0;
  db.update(schema.transactions)
    .set({ isInternalTransfer: true, categoryId: category.id })
    .where(inArray(schema.transactions.id, [...flagged]))
    .run();
  return flagged.size;
}
