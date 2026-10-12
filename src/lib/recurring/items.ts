import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { first, schema, type Db } from "@/db";
import { MAX_CENTS } from "@/lib/money";
import { FREQUENCIES, RECURRING_TYPES } from "@/db/schema";
import { MAX_ITEM_DATE, MIN_ITEM_DATE, clampDay, isDate, monthOf } from "./dates";
import { RecurringError } from "./errors";
import { normaliseIban } from "./normalise";
import { isScheduled, isScheduledMonth, type Frequency, type RecurringType } from "./occurrences";
import { planThroughMonth, syncRecurring } from "./sync";

export { RecurringError };

export type RecurringItem = typeof schema.recurringItems.$inferSelect;

export interface RecurringItemInput {
  name: string;
  type: RecurringType;
  matchCounterparty?: string | null;
  matchIban?: string | null;
  expectedAmount: number; // positive cents
  tolerance?: number; // cents, default 0
  dayOfMonth: number; // 1-31, clamped to short months
  frequency?: Frequency; // default monthly
  categoryId?: number | null;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  active?: boolean;
}

export type RecurringItemPatch = Partial<RecurringItemInput>;

type ItemValues = Omit<RecurringItem, "id">;

export const MAX_ITEMS = 500;
const MAX_TEXT = 200;

function assertToday(today: string): void {
  if (!isDate(today)) throw new RecurringError(`Ongeldige datum "${today}". Gebruik JJJJ-MM-DD.`);
}

/** Validate and normalise an item. Throws RecurringError with a user-facing message. */
async function clean(db: Db, input: RecurringItemInput): Promise<ItemValues> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new RecurringError("Geef de vaste last een naam.");
  if (name.length > MAX_TEXT)
    throw new RecurringError(`De naam is te lang (maximaal ${MAX_TEXT} tekens).`);
  if (!RECURRING_TYPES.includes(input.type)) throw new RecurringError("Kies uitgave of inkomen.");

  const matchCounterparty =
    typeof input.matchCounterparty === "string" ? input.matchCounterparty.trim() || null : null;
  const matchIban = normaliseIban(input.matchIban) || null;
  if (!matchCounterparty && !matchIban)
    throw new RecurringError(
      "Geef een naam zoals op je afschrift, of een rekeningnummer, om de betaling te herkennen.",
    );
  if ((matchCounterparty?.length ?? 0) > MAX_TEXT || (matchIban?.length ?? 0) > 34)
    throw new RecurringError("De naam op het afschrift of het rekeningnummer is te lang.");

  if (
    !Number.isSafeInteger(input.expectedAmount) ||
    input.expectedAmount <= 0 ||
    input.expectedAmount > MAX_CENTS
  )
    throw new RecurringError("Het bedrag moet groter dan nul zijn.");
  const tolerance = input.tolerance ?? 0;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > MAX_CENTS)
    throw new RecurringError("De marge moet nul of meer zijn.");
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31)
    throw new RecurringError("De dag van de maand moet tussen 1 en 31 liggen.");
  const frequency = input.frequency ?? "monthly";
  if (!FREQUENCIES.includes(frequency))
    throw new RecurringError("Kies per maand, per kwartaal of per jaar.");

  if (!isDate(input.startDate))
    throw new RecurringError(`Ongeldige begindatum "${input.startDate}".`);
  const endDate = input.endDate ?? null;
  if (endDate !== null && !isDate(endDate))
    throw new RecurringError(`Ongeldige einddatum "${endDate}".`);
  for (const [label, d] of [
    ["De begindatum", input.startDate],
    ["De einddatum", endDate],
  ] as const) {
    if (d !== null && (d < MIN_ITEM_DATE || d > MAX_ITEM_DATE))
      throw new RecurringError(`${label} moet tussen ${MIN_ITEM_DATE} en ${MAX_ITEM_DATE} liggen.`);
  }
  if (endDate !== null && endDate < input.startDate)
    throw new RecurringError("De einddatum mag niet voor de begindatum liggen.");

  const categoryId = input.categoryId ?? null;
  if (categoryId !== null) {
    const category = Number.isInteger(categoryId)
      ? await first(db.select().from(schema.categories).where(eq(schema.categories.id, categoryId)))
      : undefined;
    if (!category) throw new RecurringError(`Categorie ${categoryId} bestaat niet.`);
    if (category.type !== input.type)
      throw new RecurringError(
        `Categorie "${category.name}" hoort niet bij ${input.type === "expense" ? "een uitgave" : "een inkomen"}.`,
      );
  }
  const active = input.active ?? true;
  if (typeof active !== "boolean") throw new RecurringError("Actief moet aan of uit zijn.");

  return {
    name,
    type: input.type,
    matchCounterparty,
    matchIban,
    expectedAmount: input.expectedAmount,
    tolerance,
    dayOfMonth: input.dayOfMonth,
    frequency,
    categoryId,
    startDate: input.startDate,
    endDate,
    active,
  };
}

export async function listRecurringItems(db: Db): Promise<RecurringItem[]> {
  return await db
    .select()
    .from(schema.recurringItems)
    .orderBy(
      desc(schema.recurringItems.active),
      asc(schema.recurringItems.type),
      asc(schema.recurringItems.name),
      asc(schema.recurringItems.id),
    );
}

export async function getRecurringItem(db: Db, id: number): Promise<RecurringItem | undefined> {
  return await first(
    db.select().from(schema.recurringItems).where(eq(schema.recurringItems.id, id)),
  );
}

/**
 * Create an item, then generate its occurrences through this month (or the newest data),
 * match existing transactions to them and mark overdue ones missed.
 */
export async function createRecurringItem(
  db: Db,
  input: RecurringItemInput,
  opts: { today: string },
): Promise<RecurringItem> {
  assertToday(opts.today);
  return await db.transaction(async (tx) => {
    if ((await listRecurringItems(tx)).length >= MAX_ITEMS)
      throw new RecurringError(`Er kunnen maximaal ${MAX_ITEMS} vaste lasten zijn.`);
    const [item] = await tx
      .insert(schema.recurringItems)
      .values(await clean(tx, input))
      .returning();
    await syncRecurring(tx, {
      throughMonth: await planThroughMonth(tx, opts.today),
      today: opts.today,
    });
    return item;
  });
}

/** Delete the not-yet-matched occurrences of an item, optionally only some of them. */
async function dropUnmatched(
  db: Db,
  itemId: number,
  keep: (month: string) => boolean,
): Promise<void> {
  const unmatched = (
    await db
      .select()
      .from(schema.recurringOccurrences)
      .where(
        and(
          eq(schema.recurringOccurrences.recurringItemId, itemId),
          ne(schema.recurringOccurrences.status, "matched"),
        ),
      )
  ).filter((o) => !keep(o.month));
  if (unmatched.length === 0) return;
  await db.delete(schema.recurringOccurrences).where(
    inArray(
      schema.recurringOccurrences.id,
      unmatched.map((o) => o.id),
    ),
  );
}

/**
 * Update an item. Matched occurrences are history and are never rewritten. Of the rest:
 *  - deactivating removes all unmatched (expected and missed) occurrences;
 *  - unmatched occurrences that no longer fit the schedule (start, end, frequency) go away;
 *  - `expected` occurrences from today's month on get the new amount and day; earlier ones
 *    (and `missed` ones) keep the plan they had, since the change applies from now on.
 * Then occurrences are regenerated and matched again, so for example a corrected
 * counterparty can still pick up past payments (including rescuing missed occurrences).
 */
export async function updateRecurringItem(
  db: Db,
  id: number,
  patch: RecurringItemPatch,
  opts: { today: string },
): Promise<RecurringItem> {
  assertToday(opts.today);
  return await db.transaction(async (tx) => {
    const before = await getRecurringItem(tx, id);
    if (!before) throw new RecurringError(`Vaste last ${id} bestaat niet.`);
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as RecurringItemPatch;
    const values = await clean(tx, { ...before, ...defined });
    const [item] = await tx
      .update(schema.recurringItems)
      .set(values)
      .where(eq(schema.recurringItems.id, id))
      .returning();

    if (!item.active) {
      await dropUnmatched(tx, id, () => false);
      return item;
    }
    // Past months only fall away when the start, end or frequency excludes them; changing the
    // day of month must never delete history. From this month on the exact day applies.
    const thisMonth = monthOf(opts.today);
    await dropUnmatched(tx, id, (month) =>
      month < thisMonth ? isScheduledMonth(item, month) : isScheduled(item, month),
    );

    const future = await tx
      .select()
      .from(schema.recurringOccurrences)
      .where(
        and(
          eq(schema.recurringOccurrences.recurringItemId, id),
          eq(schema.recurringOccurrences.status, "expected"),
          gte(schema.recurringOccurrences.month, monthOf(opts.today)),
        ),
      );
    for (const o of future) {
      await tx
        .update(schema.recurringOccurrences)
        .set({
          expectedAmount: item.expectedAmount,
          expectedDate: clampDay(o.month, item.dayOfMonth),
        })
        .where(eq(schema.recurringOccurrences.id, o.id));
    }

    await syncRecurring(tx, {
      throughMonth: await planThroughMonth(tx, opts.today),
      today: opts.today,
    });
    return item;
  });
}

/**
 * Hard delete: unlink the item's matched transactions (they become ordinary spending again,
 * keeping whatever category they have), remove its occurrences, then the item.
 * To stop an item but keep its history, update it with `active: false` instead.
 * Returns false when the item does not exist.
 */
export async function deleteRecurringItem(db: Db, id: number): Promise<boolean> {
  return await db.transaction(async (tx) => {
    if (!(await getRecurringItem(tx, id))) return false;
    const occurrenceIds = (
      await tx
        .select({ id: schema.recurringOccurrences.id })
        .from(schema.recurringOccurrences)
        .where(eq(schema.recurringOccurrences.recurringItemId, id))
    ).map((o) => o.id);
    if (occurrenceIds.length > 0) {
      await tx
        .update(schema.transactions)
        .set({ matchedOccurrenceId: null })
        .where(inArray(schema.transactions.matchedOccurrenceId, occurrenceIds));
      await tx
        .delete(schema.recurringOccurrences)
        .where(eq(schema.recurringOccurrences.recurringItemId, id));
    }
    await tx.delete(schema.recurringItems).where(eq(schema.recurringItems.id, id));
    return true;
  });
}
