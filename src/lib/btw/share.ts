import { and, eq, gte, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { countedAs, projectRecurring } from "@/lib/forecast/recurring";
import { addMonths, monthOf } from "@/lib/recurring/dates";
import { getBtwSettings } from "./settings";
import { btwInside, getBtwSummary, mentions } from "./summary";

/**
 * A fixed income item is the client's when its counterparty names the client (whole words, like every BTW match).
 * An item without a counterparty is judged by its name.
 */
export function isClientItem(
  item: { matchCounterparty: string | null; name: string },
  client: string,
): boolean {
  return mentions([item.matchCounterparty ?? item.name], client);
}

/** The ids of the fixed income items that are the client's (active or not: callers decide what still counts). */
export async function clientItemIds(db: Db, client: string): Promise<Set<number>> {
  const items = await db
    .select({
      id: schema.recurringItems.id,
      name: schema.recurringItems.name,
      matchCounterparty: schema.recurringItems.matchCounterparty,
    })
    .from(schema.recurringItems)
    .where(eq(schema.recurringItems.type, "income"));
  return new Set(items.filter((i) => isClientItem(i, client)).map((i) => i.id));
}

export interface BtwShare {
  /** What the client really paid in the month (cents): own currency, not an internal transfer, money in. */
  received: number;
  /** The client's fixed income items still expected in the month and not received yet (cents). */
  expected: number;
  /** received + expected. */
  income: number;
  /** The BTW inside that income: round(21/121 x income), cents. */
  share: number;
}

/**
 * The part of the BTW to set aside for one month, from the client's income in that month:
 *
 * - a month before the current one: only what the client really paid (an invoice that never came adds nothing);
 * - the current month: what the client already paid, plus the client's fixed income items scheduled in it that are
 *   still expected (not matched to a payment, in the database or in memory, the same rule as the forecast);
 * - a later month: only the client's fixed income items expected in it.
 *
 * The move into the BTW pocket is a transfer between the person's own accounts, never a transaction that "pays" this;
 * this is the amount that move should be.
 */
export async function btwShareForMonth(
  db: Db,
  opts: { month: string; today: string },
): Promise<BtwShare> {
  const { client } = await getBtwSettings(db);
  const current = monthOf(opts.today);
  const { month } = opts;

  let received = 0;
  if (month <= current) {
    const t = schema.transactions;
    const rows = await db
      .select({ amount: t.amount, counterparty: t.counterparty, description: t.description })
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .where(
        and(
          eq(t.currency, schema.accounts.currency),
          eq(t.isInternalTransfer, false),
          gte(t.amount, 1),
          gte(t.date, `${month}-01`),
          lt(t.date, `${addMonths(month, 1)}-01`),
        ),
      );
    received = rows
      .filter((r) => mentions([r.counterparty, r.description], client))
      .reduce((s, r) => s + r.amount, 0);
  }

  let expected = 0;
  if (month >= current) {
    const clients = await clientItemIds(db, client);
    if (clients.size > 0) {
      const { byMonth } = await projectRecurring(db, { first: month, current, last: month });
      const kind = month === current ? "mixed" : "forecast";
      expected = (byMonth.get(month) ?? [])
        .filter(
          (o) =>
            o.type === "income" &&
            clients.has(o.recurringItemId) &&
            countedAs(o, month, kind) === "projected",
        )
        .reduce((s, o) => s + o.amount, 0);
    }
  }

  const income = received + expected;
  return { received, expected, income, share: btwInside(income) };
}

/**
 * What was paid to the tax office for a quarter less than was set aside for it, in the month the payment was made
 * (cents; 0 in every other month, before the payment, and when it was paid in full or more).
 *
 * The BTW set aside for a quarter is the BTW inside what the client paid in it (what the summary calls `owed`). The tax
 * office can ask for less (BTW back on purchases, for example), and the difference is the person's again. It lowers that
 * one month's BTW share, and nothing carries over to a later month. A payment made after the next quarter has begun
 * (very late) is not matched to its quarter here.
 */
export async function btwTrueUp(db: Db, opts: { month: string }): Promise<number> {
  const summary = await getBtwSummary(db, { today: `${opts.month}-01` });
  if (!summary.paid || monthOf(summary.paid.date) !== opts.month) return 0;
  return Math.max(summary.owed - summary.paid.amount, 0);
}

/**
 * The net money moved into the BTW pocket in a month (cents): moves in, minus moves back out. A move into the pocket is a
 * transfer between the person's own accounts, not spending, but it is the BTW share being set aside, so the Today screen
 * counts it against the taxes budget.
 */
export async function btwMovedIn(db: Db, opts: { month: string }): Promise<number> {
  const { pocket } = await getBtwSettings(db);
  const t = schema.transactions;
  const rows = await db
    .select({ amount: t.amount, counterparty: t.counterparty, description: t.description })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .innerJoin(schema.categories, eq(schema.categories.id, t.categoryId))
    .where(
      and(
        eq(t.currency, schema.accounts.currency),
        eq(schema.categories.type, "savings"),
        gte(t.date, `${opts.month}-01`),
        lt(t.date, `${addMonths(opts.month, 1)}-01`),
      ),
    );
  return rows
    .filter((r) => mentions([r.counterparty, r.description], pocket))
    .reduce((s, r) => s - r.amount, 0);
}
