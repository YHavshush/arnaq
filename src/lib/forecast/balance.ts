import { and, asc, eq, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays } from "@/lib/recurring/dates";

/** Every transaction that states a balance, in the account's own currency, per account in order (date, then id). */
async function balanceRows(db: Db) {
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
  const byAccount = new Map<number, { date: string; amount: number; balance: number }[]>();
  for (const r of rows) {
    const row = { date: r.date, amount: r.amount, balance: r.balanceAfter! };
    const list = byAccount.get(r.accountId);
    if (list) list.push(row);
    else byAccount.set(r.accountId, [row]);
  }
  return [...byAccount.values()];
}

/**
 * The money the person had at the start of `month` (cents), added up over their accounts from the
 * balance the bank states after each transaction: for each account the balance after its last
 * transaction before the month, or, when it has none before, the balance before its first transaction
 * (balance after minus amount). Accounts without stated balances do not count; null when no account has
 * any. Only transactions in the account's own currency are used.
 */
export async function getOpeningBalance(db: Db, month: string): Promise<number | null> {
  const start = `${month}-01`;
  const accounts = await balanceRows(db);
  let total = 0;
  for (const list of accounts) {
    const last = list.filter((r) => r.date < start).at(-1);
    total += last ? last.balance : list[0].balance - list[0].amount;
  }
  return accounts.length > 0 ? total : null;
}

/**
 * The checking balance at the end of each day from `from` to `to` (YYYY-MM-DD, both included), all accounts
 * together, with the same rules as getOpeningBalance: per account the balance after its last transaction on or
 * before the day (the later row of a day wins), or before its first transaction when the day comes earlier. A day
 * after an account's last statement keeps that account's last balance. Null when no account states a balance.
 */
export async function getDailyBalances(
  db: Db,
  from: string,
  to: string,
): Promise<Map<string, number> | null> {
  const accounts = await balanceRows(db);
  if (accounts.length === 0) return null;
  const out = new Map<string, number>();
  // Per account: the balance so far and how far into its rows the walk is.
  const state = accounts.map((list) => ({ list, next: 0, balance: list[0].balance - list[0].amount }));
  for (let day = from; day <= to; day = addDays(day, 1)) {
    let total = 0;
    for (const s of state) {
      while (s.next < s.list.length && s.list[s.next].date <= day) s.balance = s.list[s.next++].balance;
      total += s.balance;
    }
    out.set(day, total);
  }
  return out;
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
