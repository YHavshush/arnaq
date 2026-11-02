import { and, eq, gte, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { countedAs, projectRecurring } from "@/lib/forecast/recurring";
import { addMonths, monthOf } from "@/lib/recurring/dates";
import { getBtwSettings } from "./settings";
import { btwInside, mentions } from "./summary";

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
