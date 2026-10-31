import { and, count, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { first, schema, type Db } from "@/db";
import { INTERNAL_TRANSFER_CATEGORY } from "./defaults";

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * Flag transfers between the user's own accounts so they stay out of income and expenses.
 *  1. A transaction whose counterparty IBAN is one of our own account IBANs.
 *  2. An outflow and an inflow on different accounts with opposite amounts, same currency,
 *     at most `maxDays` apart. Each transaction is used in at most one pair.
 * Already-flagged transactions are left alone. Returns the number of transactions flagged.
 */
export async function detectInternalTransfers(
  db: Db,
  opts: { maxDays?: number } = {},
): Promise<number> {
  const maxDays = opts.maxDays ?? 3;
  const category = await first(
    db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, INTERNAL_TRANSFER_CATEGORY)),
  );
  if (!category) return 0;

  const accounts = await db.select().from(schema.accounts);
  const ownIbans = new Set(accounts.map((a) => a.iban).filter((i): i is string => !!i));
  const open = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.isInternalTransfer, false));

  const flagged = new Set<number>();

  for (const t of open) {
    if (t.counterpartyIban && ownIbans.has(t.counterpartyIban)) flagged.add(t.id);
  }

  const free = (t: (typeof open)[number]) => !flagged.has(t.id);
  // Index inflows by currency + amount, so each outflow only inspects real candidates
  // instead of every transaction (this runs on every import).
  const inflowsByKey = new Map<string, (typeof open)[number][]>();
  for (const t of open) {
    if (t.amount <= 0 || !free(t)) continue;
    const key = `${t.currency}|${t.amount}`;
    const list = inflowsByKey.get(key);
    if (list) list.push(t);
    else inflowsByKey.set(key, [t]);
  }

  const outflows = open
    .filter((t) => t.amount < 0 && free(t))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  for (const out of outflows) {
    if (!free(out)) continue;
    const outDay = dayNumber(out.date);
    const match = (inflowsByKey.get(`${out.currency}|${-out.amount}`) ?? [])
      .filter(
        (t) =>
          free(t) &&
          t.accountId !== out.accountId &&
          Math.abs(dayNumber(t.date) - outDay) <= maxDays,
      )
      .sort(
        (a, b) =>
          Math.abs(dayNumber(a.date) - outDay) - Math.abs(dayNumber(b.date) - outDay) ||
          a.id - b.id,
      )[0];
    if (match) {
      flagged.add(out.id);
      flagged.add(match.id);
    }
  }

  if (flagged.size === 0) return 0;
  const ids = [...flagged];
  for (let i = 0; i < ids.length; i += 500) {
    await db
      .update(schema.transactions)
      .set({ isInternalTransfer: true, categoryId: category.id })
      .where(inArray(schema.transactions.id, ids.slice(i, i + 500)));
  }
  return flagged.size;
}

/**
 * A card payment to "Revolut**1234*" is the person topping up their own Revolut: the bank statement names the card, not
 * the account, so it can never be paired by IBAN. It is money between the person's own accounts, not spending. Only
 * open rows are touched, so a choice made (or undone) is never overridden. Returns how many it flagged.
 */
export async function flagCardTopUps(db: Db): Promise<number> {
  const category = await first(
    db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.name, INTERNAL_TRANSFER_CATEGORY)),
  );
  if (!category) return 0;
  const t = schema.transactions;
  const rows = await db
    .update(t)
    .set({ isInternalTransfer: true, categoryId: category.id, categorySource: "rule" })
    .where(
      and(
        isNull(t.categoryId),
        eq(t.isInternalTransfer, false),
        lt(t.amount, 0),
        sql`${t.counterparty} ~* '^revolut\\s*\\*\\*\\s*[0-9]+\\*?$'`,
        or(isNull(t.categorySource), ne(t.categorySource, "undone"))!,
      ),
    )
    .returning({ id: t.id });
  return rows.length;
}

/**
 * The transactions treated as transfers between the person's own accounts, newest first, so a wrong
 * one (found automatically or chosen by hand) can be put back. Returns the rows shown and the total.
 */
export async function listTransfers(db: Db, limit = 20) {
  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.isInternalTransfer, true))
      .orderBy(desc(schema.transactions.date), desc(schema.transactions.id))
      .limit(limit),
    db
      .select({ total: count() })
      .from(schema.transactions)
      .where(eq(schema.transactions.isInternalTransfer, true)),
  ]);
  return { rows, total };
}
