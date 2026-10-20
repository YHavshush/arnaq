import { and, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getSavingsSettings } from "./settings";

export interface SavingsSummary {
  goal: number | null;
  /** Saved before the first upload (cents). */
  start: number;
  /** Where the savings stand now: the start plus deposits minus withdrawals (cents; can be negative). */
  saved: number;
  /** Deposits minus withdrawals in the month shown (cents). */
  thisMonth: number;
  /** How many transactions are in the Savings category. */
  lines: number;
}

const monthRange = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
};

/**
 * Money that left the current account for savings is a deposit (saved goes up); money that came back
 * out of savings is a withdrawal (saved goes down). Only rows in the account's own currency count.
 */
export async function getSavingsSummary(
  db: Db,
  opts: { today: string; month?: string },
): Promise<SavingsSummary> {
  // `month` (YYYY-MM) is the month shown on the page; without it, the month of `today`.
  const { from, to } = monthRange(opts.month ? `${opts.month}-01` : opts.today);
  const base = and(
    eq(schema.categories.type, "savings"),
    eq(schema.transactions.currency, schema.accounts.currency),
  );
  const rows = db
    .select({
      net: sql<number>`coalesce(sum(-${schema.transactions.amount}), 0)`.mapWith(Number),
      lines: sql<number>`count(*)`.mapWith(Number),
    })
    .from(schema.transactions)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId));
  const [[all], [month], settings] = await Promise.all([
    rows.where(base),
    db
      .select({
        net: sql<number>`coalesce(sum(-${schema.transactions.amount}), 0)`.mapWith(Number),
      })
      .from(schema.transactions)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
      .where(and(base, gte(schema.transactions.date, from), lte(schema.transactions.date, to))),
    getSavingsSettings(db),
  ]);
  return {
    goal: settings.goal,
    start: settings.start,
    saved: settings.start + (all?.net ?? 0),
    thisMonth: month?.net ?? 0,
    lines: all?.lines ?? 0,
  };
}
