import { and, eq, gte, lt, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { btwClientMatcher, getBtwClients, type BtwClientRule } from "./clients";
import { DEFAULT_BTW_INCOME_MATCH, DEFAULT_BTW_POCKET_MATCH } from "./defaults";
import {
  btwQuarter,
  btwReceiptWindow,
  calendarQuarter,
  previousQuarter,
  type BtwQuarter,
} from "./quarter";
import { btwOfIncome } from "./rate";
import { getBtwSettings } from "./settings";
import { mentions } from "./words";
import { addDays } from "@/lib/recurring/dates";

/** The rate math lives in ./rate; re-exported for the places that always imported it from here. */
export { BTW_RATE_PERCENT, btwInside } from "./rate";
/** The whole-word match lives in ./words (the client matcher shares it). */
export { mentions } from "./words";
/** The default client name and pocket word, until the person changes them. */
export { DEFAULT_BTW_INCOME_MATCH, DEFAULT_BTW_POCKET_MATCH };
/** Where the person pays the quarterly BTW. */
const TAX_OFFICE_MATCH = "Belastingdienst";
/** A payment to the tax office counts for a quarter up to this many days after its due date. */
const PAYMENT_GRACE_DAYS = 31;

/** Which quarter is which, and which money funds it, lives in ./quarter (one rule for every screen). */
export { btwQuarter, type BtwQuarter } from "./quarter";

interface Outflow {
  amount: number;
  date: string;
  counterparty: string | null;
  description: string | null;
}

/**
 * Tells the quarterly BTW payment to the tax office apart from what the tax office takes every month, from all the
 * person's outflows (own currency, not internal transfers): an amount paid to the tax office (TAX_OFFICE_MATCH, whole
 * words) in three or more different months is something monthly (an allowance paid back, an instalment); anything else
 * paid to the tax office is the quarterly BTW. getBtwSummary and the forecast's averages share this one rule.
 */
export function taxOfficeClassifier(outflows: Outflow[]) {
  const isTaxOffice = (r: Outflow) => mentions([r.counterparty, r.description], TAX_OFFICE_MATCH);
  const monthsByAmount = new Map<number, Set<string>>();
  for (const r of outflows.filter(isTaxOffice)) {
    const months = monthsByAmount.get(r.amount) ?? new Set<string>();
    months.add(r.date.slice(0, 7));
    monthsByAmount.set(r.amount, months);
  }
  const monthly = (amount: number) => (monthsByAmount.get(amount)?.size ?? 0) >= 3;
  return {
    monthly,
    isQuarterlyBtw: (r: Outflow) => r.amount < 0 && isTaxOffice(r) && !monthly(r.amount),
  };
}

/**
 * Whether a day falls where a quarter's BTW is paid: after the quarter ends, up to its due date plus the grace days
 * (the window getBtwSummary looks in). Only the quarter before the day's own quarter can reach it.
 */
export function inBtwPaymentWindow(date: string): boolean {
  // Calendar based for every payment lag: the return is due after the quarter of the invoices, not of the money.
  const previous = previousQuarter(calendarQuarter(date));
  return date > previous.to && date <= addDays(previous.due, PAYMENT_GRACE_DAYS);
}

/**
 * The ids of the quarterly BTW payments to the tax office (taxOfficeClassifier) dated in a BTW payment window
 * (inBtwPaymentWindow). The forecast's net worth line already takes the BTW off as it builds up on the client's
 * income, so the averages leave these payments out; otherwise the BTW would count twice ahead.
 */
export async function quarterlyBtwPaymentIds(db: Db): Promise<Set<number>> {
  const t = schema.transactions;
  const outflows = await db
    .select({
      id: t.id,
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
        lt(t.amount, 0),
      ),
    );
  const { isQuarterlyBtw } = taxOfficeClassifier(outflows);
  return new Set(
    outflows.filter((r) => isQuarterlyBtw(r) && inBtwPaymentWindow(r.date)).map((r) => r.id),
  );
}

export interface BtwSummary {
  /** The quarter of the invoices, with its due date (calendar based, whatever the payment lag). */
  quarter: BtwQuarter;
  /**
   * The days whose money can count for the quarter. Each client has its own receipt window (btwReceiptWindow with that
   * client's payment lag: the quarter itself without a lag, moved later by the lag otherwise); this is the widest one
   * covering them all, from the earliest start to the latest end. A payment inside it still only counts when it is inside
   * its own client's window. Without clients it is the quarter itself.
   */
  receipts: { from: string; to: string };
  /**
   * All of the quarter's money can be in: today is after the latest client window's end (`receipts.to`). Until then
   * `received`, `owed` and `toSetAside` are what is known so far, and more money for this quarter can still arrive.
   */
  complete: boolean;
  /**
   * Cents the clients paid, each in its own receipt window: the turnover, including clients charged no BTW (0%), whose
   * money is income all the same (and goes on the BTW return as turnover without BTW).
   */
  received: number;
  /** The BTW inside what was received, per client rate: 21 parts of every 121 for a 21% client, nothing for 0% (cents). */
  owed: number;
  /** Cents in the BTW pocket now: moved in minus moved out. */
  pocket: number;
  /** What is still missing from the pocket to cover `owed` (cents; 0 when covered). */
  toSetAside: number;
  /** The payment to the tax office for this quarter, when it has been made. */
  paid: { amount: number; date: string } | null;
  /** Of that payment, the part that did not come out of the pocket (cents). */
  fromOwnMoney: number;
  /** There is anything to show: income from a client or money in the pocket. */
  hasData: boolean;
}

/**
 * The BTW to set aside, per quarter, from the statements alone: the BTW inside what the clients paid (which includes
 * BTW), what is in the pocket, what is still missing, and what was paid to the tax office. Deductions are not known
 * here, so `owed` is the safe side: the surplus after paying is real money left over.
 *
 * A payment belongs to the client it names (btwClientMatcher: the longest matching name wins). Each client's money is
 * counted in that client's own receipt window (btwReceiptWindow with its payment lag) and at its own rate, and it is
 * all added up. The quarter itself, its due date and where the payment to the tax office is looked for do not move.
 * `clients` replaces the person's saved list (tests, previews).
 */
export async function getBtwSummary(
  db: Db,
  opts: {
    today: string;
    clients?: readonly BtwClientRule[];
    pocketMatch?: string;
  },
): Promise<BtwSummary> {
  const settings = await getBtwSettings(db);
  const clients = opts.clients ?? (await getBtwClients(db));
  const pocketMatch = opts.pocketMatch ?? settings.pocket;
  const quarter = btwQuarter(opts.today);
  const windows = new Map(clients.map((c) => [c, btwReceiptWindow(quarter, c.paymentLag)]));
  const receipts =
    windows.size === 0
      ? btwReceiptWindow(quarter, 0)
      : {
          from: [...windows.values()].map((w) => w.from).sort()[0],
          to: [...windows.values()]
            .map((w) => w.to)
            .sort()
            .at(-1)!,
        };
  const match = btwClientMatcher(clients);
  const t = schema.transactions;
  const ownCurrency = eq(t.currency, schema.accounts.currency);
  const columns = {
    id: t.id,
    date: t.date,
    amount: t.amount,
    counterparty: t.counterparty,
    description: t.description,
  };

  const [incoming, pocketMoves, payments, allOutflows] = await Promise.all([
    db
      .select(columns)
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .where(
        and(
          ownCurrency,
          eq(t.isInternalTransfer, false),
          gte(t.amount, 1),
          gte(t.date, receipts.from),
          lte(t.date, receipts.to),
        ),
      ),
    db
      .select(columns)
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .innerJoin(schema.categories, eq(schema.categories.id, t.categoryId))
      .where(and(ownCurrency, eq(schema.categories.type, "savings"))),
    db
      .select(columns)
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .where(
        and(
          ownCurrency,
          eq(t.isInternalTransfer, false),
          lt(t.amount, 0),
          gte(t.date, addDays(quarter.to, 1)),
          lte(t.date, addDays(quarter.due, PAYMENT_GRACE_DAYS)),
        ),
      ),
    // Everything paid out, to tell the tax office's quarterly BTW from what it takes every month.
    db
      .select(columns)
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .where(and(ownCurrency, eq(t.isInternalTransfer, false), lt(t.amount, 0))),
  ]);

  const text = (r: { counterparty: string | null; description: string | null }) => [
    r.counterparty,
    r.description,
  ];
  const counted = incoming.flatMap((r) => {
    const client = match(r);
    const window = client && windows.get(client);
    return window && r.date >= window.from && r.date <= window.to
      ? [{ amount: r.amount, vatPercent: client.vatPercent }]
      : [];
  });
  const received = counted.reduce((s, r) => s + r.amount, 0);
  const owed = btwOfIncome(counted);
  const mine = pocketMoves.filter((r) => mentions(text(r), pocketMatch));
  const pocket = mine.reduce((s, r) => s - r.amount, 0);

  const { isQuarterlyBtw } = taxOfficeClassifier(allOutflows);
  const paidRows = payments.filter(isQuarterlyBtw);
  const paidAmount = paidRows.reduce((s, r) => s - r.amount, 0);
  const paid =
    paidRows.length > 0
      ? { amount: paidAmount, date: paidRows.map((r) => r.date).sort()[0] }
      : null;
  // Taken out of the pocket to pay: after the quarter of the invoices ended (calendar, like the payment itself).
  const pulledOut = mine
    .filter((r) => r.amount > 0 && r.date > quarter.to)
    .reduce((s, r) => s + r.amount, 0);

  return {
    quarter,
    receipts,
    complete: opts.today > receipts.to,
    received,
    owed,
    pocket,
    toSetAside: paid ? 0 : Math.max(owed - pocket, 0),
    paid,
    fromOwnMoney: paid ? Math.max(paid.amount - pulledOut, 0) : 0,
    hasData: received > 0 || mine.length > 0,
  };
}

/**
 * What the BTW adds to net worth now: the pocket (real money, left out of savings on purpose) minus the BTW still owed
 * for the card's quarter (nothing once that quarter is paid). Negative while the pocket is short. The net worth card
 * and the forecast's net worth line both use this, so they agree.
 */
export function btwNetWorth(s: Pick<BtwSummary, "owed" | "pocket" | "paid">): number {
  return s.pocket - (s.paid ? 0 : s.owed);
}
