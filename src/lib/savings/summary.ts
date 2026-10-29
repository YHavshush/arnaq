import { and, eq, gt, gte, lte, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getSavingsSettings } from "./settings";

export interface SavingsSummary {
  goal: number | null;
  /** Saved before the first upload (cents). */
  start: number;
  /**
   * Where the savings stand now (cents; can be negative). With a balance reported by a statement: that balance plus
   * the savings moves after its date. Otherwise: the typed start plus every deposit minus withdrawal.
   */
  saved: number;
  /** True when `saved` is anchored to a balance a statement reported. */
  anchored: boolean;
  /** The day that reported balance is for. */
  anchorDate: string | null;
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
  const settings = await getSavingsSettings(db);
  const afterAnchor =
    settings.anchorDate !== null ? gt(schema.transactions.date, settings.anchorDate) : undefined;
  const [[all], [month]] = await Promise.all([
    rows.where(and(base, afterAnchor)),
    db
      .select({
        net: sql<number>`coalesce(sum(-${schema.transactions.amount}), 0)`.mapWith(Number),
      })
      .from(schema.transactions)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
      .where(and(base, gte(schema.transactions.date, from), lte(schema.transactions.date, to))),
  ]);
  return {
    goal: settings.goal,
    start: settings.start,
    saved: (settings.anchor ?? settings.start) + (all?.net ?? 0),
    anchored: settings.anchor !== null,
    anchorDate: settings.anchorDate,
    thisMonth: month?.net ?? 0,
    lines: all?.lines ?? 0,
  };
}
