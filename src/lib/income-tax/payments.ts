import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { mentions } from "@/lib/btw/words";
import { isTaxYear } from "./rate";
import { IncomeTaxError, getIncomeTaxSettings } from "./settings";

/** Where the person pays the BTW and the income tax. */
export const TAX_OFFICE_MATCH = "Belastingdienst";

export interface TaxOfficeRow {
  amount: number;
  counterparty: string | null;
  description: string | null;
  /** transactions.income_tax_year: the tax year the person picked for this payment, or null. */
  incomeTaxYear?: number | null;
}

/** The payment names the tax office (whole words, in the counterparty or the description). */
export function isTaxOffice(r: Pick<TaxOfficeRow, "counterparty" | "description">): boolean {
  return mentions([r.counterparty, r.description], TAX_OFFICE_MATCH);
}

/**
 * THE rule for income tax payments, the one place that decides it: a payment is income tax for year Y when it is money
 * out to the tax office and the person picked it as income tax for Y on the year card (transactions.income_tax_year).
 * Bank statements do not say which tax a payment to the tax office is (a Rabobank line only carries the payment
 * reference), so arnaq never guesses: the person says it once per payment. With the income tax reserve turned off
 * (`on` false) nothing is income tax.
 *
 * Every place shares this: the BTW quarter card and its payment window (taxOfficeClassifier, getBtwSummary,
 * quarterlyBtwPaymentIds) never read such a payment as the quarterly BTW, the forecast's averages leave it out (the
 * reserve is already taken off net worth as it builds), and the year card counts it as paid for Y.
 */
export function incomeTaxPaymentYear(r: TaxOfficeRow, on: boolean): number | null {
  if (!on || r.amount >= 0 || r.incomeTaxYear == null || !isTaxOffice(r)) return null;
  return r.incomeTaxYear;
}

export interface IncomeTaxPayment {
  id: number;
  date: string;
  /** Positive cents paid. */
  amount: number;
  year: number;
}

const own = () => eq(schema.transactions.currency, schema.accounts.currency);

/** Every payment that is income tax (incomeTaxPaymentYear), oldest first. Empty with the reserve off. */
export async function getIncomeTaxPayments(db: Db, on?: boolean): Promise<IncomeTaxPayment[]> {
  const isOn = on ?? (await getIncomeTaxSettings(db)).on;
  if (!isOn) return [];
  const t = schema.transactions;
  const rows = await db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterparty: t.counterparty,
      description: t.description,
      incomeTaxYear: t.incomeTaxYear,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(and(own(), eq(t.isInternalTransfer, false), lt(t.amount, 0), isNotNull(t.incomeTaxYear)))
    .orderBy(t.date, t.id);
  return rows.flatMap((r) => {
    const year = incomeTaxPaymentYear(r, true);
    return year === null ? [] : [{ id: r.id, date: r.date, amount: -r.amount, year }];
  });
}

/** The ids of the income tax payments: the forecast's averages leave them out, like the quarterly BTW. */
export async function incomeTaxPaymentIds(db: Db): Promise<Set<number>> {
  return new Set((await getIncomeTaxPayments(db)).map((p) => p.id));
}

export interface TaxOfficePayment {
  id: number;
  date: string;
  /** Positive cents paid. */
  amount: number;
  /** The tax year it is income tax for, or null when it is not marked. */
  year: number | null;
}

/**
 * The payments to the tax office from `from` (YYYY-MM-DD) on, newest first, at most `limit`: what the year card offers
 * to pick as income tax (and to unpick).
 */
export async function getTaxOfficePayments(
  db: Db,
  opts: { from: string; limit?: number },
): Promise<TaxOfficePayment[]> {
  const t = schema.transactions;
  const rows = await db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterparty: t.counterparty,
      description: t.description,
      incomeTaxYear: t.incomeTaxYear,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(and(own(), eq(t.isInternalTransfer, false), lt(t.amount, 0), gte(t.date, opts.from)))
    .orderBy(desc(t.date), desc(t.id));
  return rows
    .filter((r) => isTaxOffice(r))
    .slice(0, opts.limit ?? 12)
    .map((r) => ({ id: r.id, date: r.date, amount: -r.amount, year: r.incomeTaxYear }));
}

/** Marking a payment the person does not have (the route answers 404). */
export class TaxOfficePaymentNotFound extends Error {
  constructor() {
    super("Payment not found.");
  }
}

/**
 * Pick a payment to the tax office as income tax for a tax year (`year`), or say it is not income tax (null). Only a
 * payment out to the tax office can be picked, and only for a year the person has typed.
 */
export async function setIncomeTaxPaymentYear(
  db: Db,
  id: number,
  year: unknown,
): Promise<TaxOfficePayment> {
  if (year !== null && !isTaxYear(year))
    throw new IncomeTaxError("Pick one of your tax years for this payment.");
  const t = schema.transactions;
  const [row] = await db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterparty: t.counterparty,
      description: t.description,
    })
    .from(t)
    .where(eq(t.id, id));
  if (!row) throw new TaxOfficePaymentNotFound();
  if (row.amount >= 0 || !isTaxOffice(row))
    throw new IncomeTaxError("Only a payment to the tax office can be income tax.");
  if (year !== null) {
    const [known] = await db
      .select({ id: schema.incomeTaxYears.id })
      .from(schema.incomeTaxYears)
      .where(eq(schema.incomeTaxYears.year, year));
    if (!known) throw new IncomeTaxError("Pick one of your tax years for this payment.");
  }
  await db.update(t).set({ incomeTaxYear: year }).where(eq(t.id, id));
  return { id: row.id, date: row.date, amount: -row.amount, year };
}
