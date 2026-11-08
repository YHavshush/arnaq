import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getBtwSettings } from "@/lib/btw/settings";
import { btwPot } from "@/lib/btw/pot";
import { getBtwSummary, mentions } from "@/lib/btw/summary";
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
  /**
   * With "My BTW pot is part of my savings" on: the part of `saved` counted as BTW money (cents, see btwPot); 0 or left
   * out otherwise. `saved` still holds it (net worth counts the savings once); the goal does not (goalSaved).
   */
  btwPot?: number;
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
 * The BTW pocket is not savings: that money is owed to the tax office, so its moves are left out.
 */
export async function getSavingsSummary(
  db: Db,
  opts: { today: string; month?: string },
): Promise<SavingsSummary> {
  // `month` (YYYY-MM) is the month shown on the page; without it, the month of `today`.
  const { from, to } = monthRange(opts.month ? `${opts.month}-01` : opts.today);
  const settings = await getSavingsSettings(db);
  const { pocket, potInSavings } = await getBtwSettings(db);
  const moves = (
    await db
      .select({
        date: schema.transactions.date,
        amount: schema.transactions.amount,
        counterparty: schema.transactions.counterparty,
        description: schema.transactions.description,
      })
      .from(schema.transactions)
      .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
      .where(
        and(
          eq(schema.categories.type, "savings"),
          eq(schema.transactions.currency, schema.accounts.currency),
        ),
      )
  ).filter((r) => !mentions([r.counterparty, r.description], pocket));
  // With a statement's savings balance, only the moves after its date add to it.
  const counted = moves.filter((r) => settings.anchorDate === null || r.date > settings.anchorDate);
  const deposited = (rows: typeof moves) => rows.reduce((s, r) => s - r.amount, 0);
  const saved = (settings.anchor ?? settings.start) + deposited(counted);
  // The pot is what the savings hold for the BTW now (today), whatever month is shown.
  const pot = potInSavings
    ? btwPot({
        on: true,
        saved,
        toSetAside: (await getBtwSummary(db, { today: opts.today })).toSetAside,
      }).pot
    : 0;
  return {
    goal: settings.goal,
    start: settings.start,
    saved,
    anchored: settings.anchor !== null,
    anchorDate: settings.anchorDate,
    thisMonth: deposited(moves.filter((r) => r.date >= from && r.date <= to)),
    lines: counted.length,
    btwPot: pot,
  };
}
