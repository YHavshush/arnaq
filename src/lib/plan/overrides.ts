import { and, asc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { MAX_CENTS } from "@/lib/money";

/** Ids are Postgres `integer` (int4) columns. */
const MAX_ID = 2_147_483_647;
import { addMonths, monthOf } from "@/lib/recurring/dates";

/** Invalid plan input (HTTP 422). */
export class PlanError extends Error {}

/** How far ahead the plan grid can be typed: up to this many months after the current month. */
export const PLAN_HORIZON_MONTHS = 24;

/** What a typed cell is about: a category's everyday spending, or a fixed item (income or expense). */
export type PlanKind = "category" | "item";

export interface PlanOverride {
  kind: PlanKind;
  /** The category id or the fixed item id. */
  id: number;
  /** YYYY-MM */
  month: string;
  /** Cents, >= 0. */
  amount: number;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const t = schema.planOverrides;

/** Everything typed in the plan, oldest month first; with `from`/`to` only those months (inclusive). */
export async function getPlanOverrides(
  db: Db,
  range: { from?: string; to?: string } = {},
): Promise<PlanOverride[]> {
  const where: SQL[] = [];
  if (range.from !== undefined) where.push(gte(t.month, range.from));
  if (range.to !== undefined) where.push(lte(t.month, range.to));
  const rows = await db
    .select()
    .from(t)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(t.month), asc(t.id));
  return rows.map((r) =>
    r.categoryId !== null
      ? { kind: "category", id: r.categoryId, month: r.month, amount: r.amount }
      : { kind: "item", id: r.itemId!, month: r.month, amount: r.amount },
  );
}

/** Typed amounts looked up by target and month: `${id}:${month}` -> cents. */
export interface OverrideIndex {
  items: Map<string, number>;
  categories: Map<string, number>;
}

export const overrideKey = (id: number, month: string) => `${id}:${month}`;

export function indexOverrides(rows: PlanOverride[]): OverrideIndex {
  const out: OverrideIndex = { items: new Map(), categories: new Map() };
  for (const r of rows)
    (r.kind === "item" ? out.items : out.categories).set(overrideKey(r.id, r.month), r.amount);
  return out;
}

/** Only the typed fixed item amounts in `from`..`to` (the forecast's recurring projection reads these). */
export async function getItemOverrides(
  db: Db,
  range: { from: string; to: string },
): Promise<Map<string, number>> {
  const rows = await db
    .select({ itemId: t.itemId, month: t.month, amount: t.amount })
    .from(t)
    .where(and(isNotNull(t.itemId), gte(t.month, range.from), lte(t.month, range.to)));
  return new Map(rows.map((r) => [overrideKey(r.itemId!, r.month), r.amount]));
}

export interface PlanInput {
  kind: unknown;
  id: unknown;
  month: unknown;
  /** Cents, or null to clear. */
  amount: unknown;
  /** "month": only this month; "after": this month and every later one up to PLAN_HORIZON_MONTHS after now. */
  scope: unknown;
}

/**
 * Type (or with amount null, clear) a plan cell. Only a category's everyday spending (an expense category) and a fixed
 * item can be typed; the BTW row follows income and is never typed. Months before the current month are refused: what
 * happened is real. The current month is allowed, the forecast only applies it to the part still to come. Ids are looked
 * up as the current person, so someone else's category or item is unknown. Returns the months written or cleared.
 */
export async function setPlanOverride(
  db: Db,
  input: PlanInput,
  today: string,
): Promise<{ months: string[] }> {
  const { kind, id, month, amount, scope } = input;
  if (kind !== "category" && kind !== "item")
    throw new PlanError("Only a category or a fixed item can be typed in the plan.");
  if (scope !== "month" && scope !== "after")
    throw new PlanError('The scope must be "month" or "after".');
  if (typeof month !== "string" || !MONTH_RE.test(month))
    throw new PlanError(`Invalid month "${String(month)}", use YYYY-MM.`);
  if (
    amount !== null &&
    !(
      typeof amount === "number" &&
      Number.isSafeInteger(amount) &&
      amount >= 0 &&
      amount <= MAX_CENTS
    )
  )
    throw new PlanError("The amount must be a whole number of cents, zero or more.");
  const current = monthOf(today);
  const last = addMonths(current, PLAN_HORIZON_MONTHS);
  if (month < current) throw new PlanError("A month that has passed cannot be planned.");
  if (month > last) throw new PlanError(`The plan goes up to ${PLAN_HORIZON_MONTHS} months ahead.`);
  // Ids are Postgres integers (int4): anything outside that range cannot exist.
  if (
    typeof id !== "number" ||
    !Number.isInteger(id) ||
    id < 1 ||
    id > MAX_ID ||
    !(await exists(db, kind, id))
  )
    throw new PlanError(kind === "category" ? "Unknown category." : "Unknown fixed item.");

  const target = kind === "category" ? t.categoryId : t.itemId;
  if (amount === null) {
    const cleared = await db
      .delete(t)
      .where(and(eq(target, id), scope === "after" ? gte(t.month, month) : eq(t.month, month)))
      .returning({ month: t.month });
    return { months: cleared.map((r) => r.month).sort() };
  }

  const months: string[] = [];
  for (let m = month; m <= (scope === "after" ? last : month); m = addMonths(m, 1)) months.push(m);
  await db
    .insert(t)
    .values(
      months.map((m) =>
        kind === "category"
          ? { categoryId: id, month: m, amount }
          : { itemId: id, month: m, amount },
      ),
    )
    .onConflictDoUpdate({
      target:
        kind === "category" ? [t.userId, t.categoryId, t.month] : [t.userId, t.itemId, t.month],
      set: { amount, updatedAt: sql`now()` },
    });
  return { months };
}

/** The person's own expense category or fixed item with this id (row level security hides everyone else's). */
async function exists(db: Db, kind: PlanKind, id: number): Promise<boolean> {
  if (kind === "category") {
    const rows = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(and(eq(schema.categories.id, id), eq(schema.categories.type, "expense")));
    return rows.length > 0;
  }
  const rows = await db
    .select({ id: schema.recurringItems.id })
    .from(schema.recurringItems)
    .where(eq(schema.recurringItems.id, id));
  return rows.length > 0;
}
