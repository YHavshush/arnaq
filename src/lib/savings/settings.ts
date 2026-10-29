import { schema, type Db } from "@/db";
import { isDate } from "@/lib/recurring/dates";

/** A goal or starting amount that makes no sense (the message is English; it is translated at the API edge). */
export class SavingsError extends Error {}

/** Far more than anyone saves, and well inside what a number can hold exactly. */
const MAX_CENTS = 10 ** 12;

export interface SavingsSettings {
  /** The total the person wants to have saved (cents), or null. */
  goal: number | null;
  /** What they had saved before their first upload (cents). Ignored once a statement has reported the balance. */
  start: number;
  /** The savings balance a statement reported (cents), and the day it is for (YYYY-MM-DD); null until one has. */
  anchor: number | null;
  anchorDate: string | null;
}

export async function getSavingsSettings(db: Db): Promise<SavingsSettings> {
  const [row] = await db.select().from(schema.userSettings);
  return {
    goal: row?.savingsGoal ?? null,
    start: row?.savingsStart ?? 0,
    anchor: row?.savingsAnchor ?? null,
    anchorDate: row?.savingsAnchorDate ?? null,
  };
}

/** Change the goal and/or the starting amount. `goal: null` clears the goal; leave a field out to keep it. */
export async function setSavingsSettings(
  db: Db,
  input: { goal?: number | null; start?: number },
): Promise<SavingsSettings> {
  const values: { savingsGoal?: number | null; savingsStart?: number } = {};
  if (input.goal !== undefined) {
    if (
      input.goal !== null &&
      !(Number.isSafeInteger(input.goal) && input.goal > 0 && input.goal <= MAX_CENTS)
    )
      throw new SavingsError("The savings goal must be a positive amount.");
    values.savingsGoal = input.goal;
  }
  if (input.start !== undefined) {
    if (!(Number.isSafeInteger(input.start) && input.start >= 0 && input.start <= MAX_CENTS))
      throw new SavingsError("The amount already saved cannot be negative.");
    values.savingsStart = input.start;
  }
  if (Object.keys(values).length > 0)
    await db
      .insert(schema.userSettings)
      .values(values)
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
  return await getSavingsSettings(db);
}

/**
 * The savings balance a bank statement reports, for the day it is for. The total saved counts on from here, so the
 * person never has to type it. Only moves forward: an older statement does not replace a newer balance.
 */
export async function setSavingsAnchor(
  db: Db,
  input: { amount: number; asOf: string },
): Promise<SavingsSettings> {
  if (!(Number.isSafeInteger(input.amount) && input.amount >= 0 && input.amount <= MAX_CENTS))
    throw new SavingsError("The savings balance must be a positive amount.");
  if (!isDate(input.asOf)) throw new SavingsError("The savings balance needs a date.");
  const current = await getSavingsSettings(db);
  if (current.anchorDate !== null && input.asOf < current.anchorDate) return current;
  const values = { savingsAnchor: input.amount, savingsAnchorDate: input.asOf };
  await db
    .insert(schema.userSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
  return await getSavingsSettings(db);
}
