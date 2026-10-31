import { and, asc, eq, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@/db";

/**
 * The money the person had at the start of `month` (cents), added up over their accounts from the
 * balance the bank states after each transaction: for each account the balance after its last
 * transaction before the month, or, when it has none before, the balance before its first transaction
 * (balance after minus amount). Accounts without stated balances do not count; null when no account has
 * any. Only transactions in the account's own currency are used.
 */
export async function getOpeningBalance(db: Db, month: string): Promise<number | null> {
  const start = `${month}-01`;
  const rows = await db
    .select({
      accountId: schema.transactions.accountId,
      date: schema.transactions.date,
      amount: schema.transactions.amount,
      balanceAfter: schema.transactions.balanceAfter,
    })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        isNotNull(schema.transactions.balanceAfter),
        eq(schema.transactions.currency, schema.accounts.currency),
      ),
    )
    .orderBy(
      asc(schema.transactions.accountId),
      asc(schema.transactions.date),
      asc(schema.transactions.id),
    );
  const byAccount = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byAccount.get(r.accountId);
    if (list) list.push(r);
    else byAccount.set(r.accountId, [r]);
  }
  let total = 0;
  let any = false;
  for (const list of byAccount.values()) {
    const before = list.filter((r) => r.date < start);
    const last = before.at(-1);
    if (last) total += last.balanceAfter!;
    else total += list[0].balanceAfter! - list[0].amount;
    any = true;
  }
  return any ? total : null;
}

export interface AccountBalance {
  accountId: number;
  name: string;
  bank: string;
  /** Cents, the balance the bank states after the newest transaction. */
  balance: number;
  /** The date of that transaction (YYYY-MM-DD): the balance is as of this day. */
  asOf: string;
}

/**
 * What each account held after its newest transaction, with the day that is for: the parts that add up to the
 * accounts side of net worth. Accounts without a stated balance, and other-currency rows, are left out
 * (the same rules as getOpeningBalance).
 */
export async function getAccountBalances(db: Db): Promise<AccountBalance[]> {
  const rows = await db
    .select({
      accountId: schema.transactions.accountId,
      name: schema.accounts.name,
      bank: schema.accounts.bank,
      date: schema.transactions.date,
      balanceAfter: schema.transactions.balanceAfter,
    })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        isNotNull(schema.transactions.balanceAfter),
        eq(schema.transactions.currency, schema.accounts.currency),
      ),
    )
    .orderBy(
      asc(schema.transactions.accountId),
      asc(schema.transactions.date),
      asc(schema.transactions.id),
    );
  const last = new Map<number, AccountBalance>();
  for (const r of rows)
    last.set(r.accountId, {
      accountId: r.accountId,
      name: r.name,
      bank: r.bank,
      balance: r.balanceAfter!,
      asOf: r.date,
    });
  return [...last.values()];
}
