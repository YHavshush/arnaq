import { and, eq, gte, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { countedAs, projectRecurring } from "@/lib/forecast/recurring";
import { addMonths, monthOf } from "@/lib/recurring/dates";
import { btwClientOfItem, loadBtwMatcher } from "./clients";
import { btwOfIncome, type BtwVatPercent } from "./rate";
import { getBtwSettings } from "./settings";
import { getBtwSummary, mentions } from "./summary";

/**
 * The fixed income items that are a BTW client's (btwClientOfItem: the counterparty names the client, or the name when
 * there is no counterparty), with that client's rate: item id -> rate. Active or not: callers decide what still counts.
 * The monthly share, the plan grid and the forecast all read the clients' items here.
 */
export async function clientItemRates(
  db: Db,
  loaded?: Awaited<ReturnType<typeof loadBtwMatcher>>,
): Promise<Map<number, BtwVatPercent>> {
  const { match } = loaded ?? (await loadBtwMatcher(db));
  const items = await db
    .select({
      id: schema.recurringItems.id,
      name: schema.recurringItems.name,
      matchCounterparty: schema.recurringItems.matchCounterparty,
    })
    .from(schema.recurringItems)
    .where(eq(schema.recurringItems.type, "income"));
  const rates = new Map<number, BtwVatPercent>();
  for (const item of items) {
    const client = btwClientOfItem(match, item);
    if (client) rates.set(item.id, client.vatPercent);
  }
  return rates;
}

export interface BtwShare {
  /**
   * What the clients really paid in the month (cents): own currency, not an internal transfer, money in. Every client,
   * a 0% one too (turnover, like BtwSummary.received).
   */
  received: number;
  /** The clients' fixed income items still expected in the month and not received yet (cents). */
  expected: number;
  /** received + expected. */
  income: number;
  /** The BTW inside that income at each client's rate (21 parts of every 121 for a 21% client, nothing for 0%), cents. */
  share: number;
}

/**
 * The part of the BTW to set aside for one month, from the clients' income in that month (each payment or item belongs
 * to the client it names, btwClientMatcher, and carries that client's rate):
 *
 * - a month before the current one: only what the clients really paid (an invoice that never came adds nothing);
 * - the current month: what the clients already paid, plus their fixed income items scheduled in it that are still
 *   expected (not matched to a payment, in the database or in memory, the same rule as the forecast);
 * - a later month: only the clients' fixed income items expected in it.
 *
 * The move into the BTW pocket is a transfer between the person's own accounts, never a transaction that "pays" this;
 * this is the amount that move should be.
 *
 * The share is set aside in the month the money arrives, whatever the client's payment lag: the lag only decides which
 * quarter that money counts for (btwQuarterOfReceipt), which matters for the quarter's total and its true-up, not for
 * the month. The rate does matter: a 0% client's money adds nothing.
 */
export async function btwShareForMonth(
  db: Db,
  opts: { month: string; today: string },
): Promise<BtwShare> {
  const income = await clientIncomeByMonth(db, {
    from: opts.month,
    to: opts.month,
    today: opts.today,
  });
  return shareOf(income.get(opts.month) ?? { received: [], expected: [] });
}

/** One payment or expected item of a client, with that client's rate. */
export interface ClientIncomePart {
  amount: number;
  vatPercent: BtwVatPercent;
}

/** A month's client income: what the clients really paid, and their fixed income items still expected in it. */
export interface ClientIncomeMonth {
  received: ClientIncomePart[];
  expected: ClientIncomePart[];
}

/** A month's client income as the BTW share (btwShareForMonth). */
export function shareOf(m: ClientIncomeMonth): BtwShare {
  const sum = (xs: ClientIncomePart[]) => xs.reduce((s, p) => s + p.amount, 0);
  const received = sum(m.received);
  const expected = sum(m.expected);
  return {
    received,
    expected,
    income: received + expected,
    share: btwOfIncome([...m.received, ...m.expected]),
  };
}

/**
 * The clients' income per month from `from` to `to` (YYYY-MM, both included), split into what was received and what is
 * still expected, by the rules of btwShareForMonth (a month before today's: only what came in; today's month: what came
 * in plus the fixed income items still expected; a later month: only what is expected). One query for the payments and
 * one projection for the items, so a whole year costs no more than a month. The BTW share and the income tax reserve
 * (src/lib/income-tax) both read the clients' money here, so they cannot drift apart. Every month in the range is in the
 * map, empty or not.
 */
export async function clientIncomeByMonth(
  db: Db,
  opts: { from: string; to: string; today: string },
): Promise<Map<string, ClientIncomeMonth>> {
  const loaded = await loadBtwMatcher(db);
  const { match } = loaded;
  const current = monthOf(opts.today);
  const { from, to } = opts;
  const out = new Map<string, ClientIncomeMonth>();
  for (let m = from; m <= to; m = addMonths(m, 1)) out.set(m, { received: [], expected: [] });
  if (loaded.clients.length === 0 || from > to) return out;

  const lastReceived = to < current ? to : current;
  if (from <= lastReceived) {
    const t = schema.transactions;
    const rows = await db
      .select({
        date: t.date,
        amount: t.amount,
        counterparty: t.counterparty,
        description: t.description,
      })
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .where(
        and(
          eq(t.currency, schema.accounts.currency),
          eq(t.isInternalTransfer, false),
          gte(t.amount, 1),
          gte(t.date, `${from}-01`),
          lt(t.date, `${addMonths(lastReceived, 1)}-01`),
        ),
      );
    for (const r of rows) {
      const client = match(r);
      if (!client) continue;
      out.get(monthOf(r.date))?.received.push({ amount: r.amount, vatPercent: client.vatPercent });
    }
  }

  const firstExpected = from > current ? from : current;
  if (firstExpected <= to) {
    const rates = await clientItemRates(db, loaded);
    if (rates.size > 0) {
      const { byMonth } = await projectRecurring(db, { first: firstExpected, current, last: to });
      for (let m = firstExpected; m <= to; m = addMonths(m, 1)) {
        const kind = m === current ? "mixed" : "forecast";
        for (const o of byMonth.get(m) ?? []) {
          const vatPercent = rates.get(o.recurringItemId);
          if (o.type !== "income" || vatPercent === undefined) continue;
          if (countedAs(o, m, kind) !== "projected") continue;
          out.get(m)?.expected.push({ amount: o.amount, vatPercent });
        }
      }
    }
  }
  return out;
}

/**
 * What was paid to the tax office for a quarter less than was set aside for it, in the month the payment was made
 * (cents; 0 in every other month, before the payment, and when it was paid in full or more).
 *
 * The BTW set aside for a quarter is the BTW inside what the clients paid, each in its own receipt window (what the
 * summary calls `owed`; with a payment lag a client's window is moved later, see btwReceiptWindow). The payment month
 * itself is calendar based: the month after the quarter, where getBtwSummary looks for the payment. The tax
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
