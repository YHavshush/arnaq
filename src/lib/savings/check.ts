import { and, eq, gt, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getSavingsSettings } from "./settings";

export interface SavingsCheck {
  /** What arnaq expected the savings to be on `asOf`: the last statement's balance plus the moves sorted as Savings since. */
  expected: number;
  /** What the new statement says (cents). */
  actual: number;
  /** actual - expected: positive when the statement holds more than arnaq expected. */
  difference: number;
  /** The day of the previous statement balance, and of the new one. */
  from: string;
  asOf: string;
  /**
   * match: the same, to within rounding. interest: the statement has a little more, which is what savings interest looks
   * like (it is not on the list of transactions). off: more than interest can explain, so a move to or from savings is
   * probably missing or sorted under another category.
   */
  status: "match" | "interest" | "off";
}

/** Within this the two agree (cents). */
const SAME = 50;
/** A statement holding up to this much more than expected is taken as interest (cents). */
const INTEREST = 300;

/**
 * Compare the savings balance a statement reports with what the app expects: the previous statement's balance plus the
 * moves into and out of savings between the two days (every move sorted as Savings, BTW ones included: the statement's
 * balance holds them too). Null when there is nothing to compare with (the first balance, or an older statement).
 * Call it before the new balance is stored.
 */
export async function checkSavingsBalance(
  db: Db,
  reported: { amount: number; asOf: string },
): Promise<SavingsCheck | null> {
  const settings = await getSavingsSettings(db);
  if (settings.anchor === null || settings.anchorDate === null) return null;
  if (reported.asOf <= settings.anchorDate) return null;
  const rows = await db
    .select({ amount: schema.transactions.amount })
    .from(schema.transactions)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .where(
      and(
        eq(schema.categories.type, "savings"),
        eq(schema.transactions.currency, schema.accounts.currency),
        gt(schema.transactions.date, settings.anchorDate),
        lte(schema.transactions.date, reported.asOf),
      ),
    );
  // Money out of the current account into savings is negative there, and adds to savings.
  const expected = settings.anchor + rows.reduce((s, r) => s - r.amount, 0);
  const difference = reported.amount - expected;
  return {
    expected,
    actual: reported.amount,
    difference,
    from: settings.anchorDate,
    asOf: reported.asOf,
    status:
      Math.abs(difference) <= SAME
        ? "match"
        : difference > 0 && difference <= INTEREST
          ? "interest"
          : "off",
  };
}
