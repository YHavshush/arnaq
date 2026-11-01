import { schema, type Db } from "@/db";
import { ForecastError } from "./errors";
import type { VariableAverages } from "./variable";

const MAX_CENTS = 10 ** 10;

/** What the person expects to spend each month on everyday things (cents), or null when they have not said. */
export async function getOwnSpending(db: Db): Promise<number | null> {
  const [row] = await db.select().from(schema.userSettings);
  return row?.forecastOwnSpending ?? null;
}

/** Save (or with null, clear) the monthly everyday spending the person expects. */
export async function setOwnSpending(db: Db, amount: number | null): Promise<number | null> {
  if (amount !== null && !(Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_CENTS))
    throw new ForecastError("The expected spending must be an amount of zero or more.");
  await db
    .insert(schema.userSettings)
    .values({ forecastOwnSpending: amount })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: { forecastOwnSpending: amount },
    });
  return await getOwnSpending(db);
}

/**
 * The person's own number replaces the averages as one total: it is shared out over the categories in the same
 * proportions as their averages (so the breakdown still makes sense), or put under "uncategorised" when there are no
 * averages to go by.
 */
export function scaleAverages(averages: VariableAverages, own: number): VariableAverages {
  const total =
    [...averages.byCategory.values()].reduce((s, v) => s + v, 0) + averages.uncategorised;
  if (total <= 0) return { ...averages, byCategory: new Map(), uncategorised: own };
  const byCategory = new Map<number, number>();
  let used = 0;
  for (const [id, v] of averages.byCategory) {
    const share = Math.round((v * own) / total);
    byCategory.set(id, share);
    used += share;
  }
  // Whatever rounding leaves over goes to the uncategorised line, so the total is exactly what was typed.
  return { ...averages, byCategory, uncategorised: Math.max(own - used, 0) };
}
