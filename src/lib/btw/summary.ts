import { and, eq, gte, lt, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays, addMonths, clampDay } from "@/lib/recurring/dates";
import { normaliseCounterparty } from "@/lib/recurring/normalise";

/** The standard Dutch rate. */
export const BTW_RATE_PERCENT = 21;
/** Who pays the person, and what marks a move into the BTW pocket. Defaults until they can be changed. */
export const DEFAULT_BTW_INCOME_MATCH = "Featurn";
export const DEFAULT_BTW_POCKET_MATCH = "BTW";
/** Where the person pays the quarterly BTW. */
const TAX_OFFICE_MATCH = "Belastingdienst";
/** A payment to the tax office counts for a quarter up to this many days after its due date. */
const PAYMENT_GRACE_DAYS = 31;

export interface BtwQuarter {
  /** "2026-Q3". */
  label: string;
  from: string;
  to: string;
  /** The last day to file and pay: the end of the month after the quarter. */
  due: string;
}

function quarterOf(year: number, q: number): BtwQuarter {
  const first = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}`;
  const last = addMonths(first, 2);
  return {
    label: `${year}-Q${q}`,
    from: `${first}-01`,
    to: clampDay(last, 31),
    due: clampDay(addMonths(last, 1), 31),
  };
}

/** The quarter the card is about: the earliest one whose payment is still due today or later. */
export function btwQuarter(today: string): BtwQuarter {
  const year = Number(today.slice(0, 4));
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const current = quarterOf(year, q);
  const previous = q === 1 ? quarterOf(year - 1, 4) : quarterOf(year, q - 1);
  return previous.due >= today ? previous : current;
}

export interface BtwSummary {
  quarter: BtwQuarter;
  /** Cents the client paid in the quarter. */
  received: number;
  /** 21% of what was received (cents). */
  owed: number;
  /** Cents in the BTW pocket now: moved in minus moved out. */
  pocket: number;
  /** What is still missing from the pocket to cover `owed` (cents; 0 when covered). */
  toSetAside: number;
  /** The payment to the tax office for this quarter, when it has been made. */
  paid: { amount: number; date: string } | null;
  /** Of that payment, the part that did not come out of the pocket (cents). */
  fromOwnMoney: number;
  /** There is anything to show: income from the client or money in the pocket. */
  hasData: boolean;
}

/** Whole-word, accent- and case-insensitive: "btw" is in "To EUR BTW" but not in "Tubtwo". */
const words = (s: string | null | undefined) =>
  ` ${normaliseCounterparty(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
/** True when the needle appears as a whole word in any of the texts. */
export const mentions = (text: Array<string | null>, needle: string) =>
  words(text.filter(Boolean).join(" ")).includes(words(needle));

/**
 * The BTW to set aside, per quarter, from the statements alone: 21% of what the client paid, what is
 * in the pocket, what is still missing, and what was paid to the tax office. Deductions are not known
 * here, so `owed` is the safe side: the surplus after paying is real money left over.
 */
export async function getBtwSummary(
  db: Db,
  opts: { today: string; incomeMatch?: string; pocketMatch?: string },
): Promise<BtwSummary> {
  const incomeMatch = opts.incomeMatch ?? DEFAULT_BTW_INCOME_MATCH;
  const pocketMatch = opts.pocketMatch ?? DEFAULT_BTW_POCKET_MATCH;
  const quarter = btwQuarter(opts.today);
  const t = schema.transactions;
  const ownCurrency = eq(t.currency, schema.accounts.currency);
  const columns = {
    id: t.id,
    date: t.date,
    amount: t.amount,
    counterparty: t.counterparty,
    description: t.description,
  };

  const [incoming, pocketMoves, payments] = await Promise.all([
    db
      .select(columns)
      .from(t)
      .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
      .where(
        and(
          ownCurrency,
          eq(t.isInternalTransfer, false),
          gte(t.amount, 1),
          gte(t.date, quarter.from),
          lte(t.date, quarter.to),
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
  ]);

  const text = (r: { counterparty: string | null; description: string | null }) => [
    r.counterparty,
    r.description,
  ];
  const received = incoming
    .filter((r) => mentions(text(r), incomeMatch))
    .reduce((s, r) => s + r.amount, 0);
  const owed = Math.round((received * BTW_RATE_PERCENT) / 100);
  const mine = pocketMoves.filter((r) => mentions(text(r), pocketMatch));
  const pocket = mine.reduce((s, r) => s - r.amount, 0);

  const paidRows = payments.filter((r) => mentions(text(r), TAX_OFFICE_MATCH));
  const paidAmount = paidRows.reduce((s, r) => s - r.amount, 0);
  const paid =
    paidRows.length > 0
      ? { amount: paidAmount, date: paidRows.map((r) => r.date).sort()[0] }
      : null;
  const pulledOut = mine
    .filter((r) => r.amount > 0 && r.date > quarter.to)
    .reduce((s, r) => s + r.amount, 0);

  return {
    quarter,
    received,
    owed,
    pocket,
    toSetAside: paid ? 0 : Math.max(owed - pocket, 0),
    paid,
    fromOwnMoney: paid ? Math.max(paid.amount - pulledOut, 0) : 0,
    hasData: received > 0 || mine.length > 0,
  };
}
