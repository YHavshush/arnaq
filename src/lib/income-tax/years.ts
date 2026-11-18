import { and, asc, count, eq, ne } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { MAX_CENTS } from "@/lib/money";
import {
  isIncomeTaxRate,
  isTaxYear,
  MAX_INCOME_TAX_RATE,
  MAX_INCOME_TAX_YEARS,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
} from "./rate";
import { IncomeTaxError } from "./settings";

/**
 * The person's tax years: the reserve rate the adviser gave for each (basis points), and the real amount from the
 * aanslag once it is known (cents). No row for a year means nothing is kept apart for it: no card, no share.
 */
export interface IncomeTaxYear {
  id: number;
  year: number;
  /** Basis points: 490 = 4.9%. */
  rate: number;
  /** The amount on the aanslag (cents); null until it is known. */
  knownAmount: number | null;
}

export { MAX_INCOME_TAX_YEARS };

/** An edit or delete for a tax year the person does not have (the route answers 404). */
export class IncomeTaxYearNotFound extends Error {
  constructor() {
    super("Tax year not found.");
  }
}

const columns = {
  id: schema.incomeTaxYears.id,
  year: schema.incomeTaxYears.year,
  rate: schema.incomeTaxYears.rate,
  knownAmount: schema.incomeTaxYears.knownAmount,
};

/** The person's tax years, oldest first. */
export async function getIncomeTaxYears(db: Db): Promise<IncomeTaxYear[]> {
  return await db
    .select(columns)
    .from(schema.incomeTaxYears)
    .orderBy(asc(schema.incomeTaxYears.year));
}

function readYear(v: unknown): number {
  if (!isTaxYear(v))
    throw new IncomeTaxError(
      `The tax year must be a year from ${MIN_TAX_YEAR} to ${MAX_TAX_YEAR}.`,
    );
  return v;
}
function readRate(v: unknown): number {
  if (!isIncomeTaxRate(v))
    throw new IncomeTaxError(`The rate must be from 0% to ${MAX_INCOME_TAX_RATE / 100}%.`);
  return v;
}
function readKnown(v: unknown): number | null {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > MAX_CENTS)
    throw new IncomeTaxError("The amount of the tax bill must be zero or more.");
  return v as number;
}

async function assertYearFree(db: Db, year: number, exceptId?: number) {
  const same = eq(schema.incomeTaxYears.year, year);
  const [taken] = await db
    .select({ id: schema.incomeTaxYears.id })
    .from(schema.incomeTaxYears)
    .where(exceptId === undefined ? same : and(same, ne(schema.incomeTaxYears.id, exceptId)))
    .limit(1);
  if (taken) throw new IncomeTaxError("You already have this tax year.");
}

/** Add a tax year. The year and the rate are needed; the known amount is optional. */
export async function addIncomeTaxYear(
  db: Db,
  input: { year?: unknown; rate?: unknown; knownAmount?: unknown },
): Promise<IncomeTaxYear> {
  const year = readYear(input.year);
  const rate = readRate(input.rate);
  const knownAmount = input.knownAmount === undefined ? null : readKnown(input.knownAmount);
  const [{ n }] = await db.select({ n: count() }).from(schema.incomeTaxYears);
  if (n >= MAX_INCOME_TAX_YEARS)
    throw new IncomeTaxError(`You can have up to ${MAX_INCOME_TAX_YEARS} tax years.`);
  await assertYearFree(db, year);
  const [row] = await db
    .insert(schema.incomeTaxYears)
    .values({ year, rate, knownAmount })
    .returning(columns);
  return row;
}

/** Change a tax year; a field left out is kept, a known amount of null clears it. */
export async function updateIncomeTaxYear(
  db: Db,
  id: number,
  input: { year?: unknown; rate?: unknown; knownAmount?: unknown },
): Promise<IncomeTaxYear> {
  const values: { year?: number; rate?: number; knownAmount?: number | null } = {};
  if (input.year !== undefined) values.year = readYear(input.year);
  if (input.rate !== undefined) values.rate = readRate(input.rate);
  if (input.knownAmount !== undefined) values.knownAmount = readKnown(input.knownAmount);
  if (values.year !== undefined) await assertYearFree(db, values.year, id);
  const where = eq(schema.incomeTaxYears.id, id);
  const [row] =
    Object.keys(values).length > 0
      ? await db.update(schema.incomeTaxYears).set(values).where(where).returning(columns)
      : await db.select(columns).from(schema.incomeTaxYears).where(where);
  if (!row) throw new IncomeTaxYearNotFound();
  return row;
}

/** Remove a tax year; false when the person has no tax year with this id. */
export async function deleteIncomeTaxYear(db: Db, id: number): Promise<boolean> {
  const gone = await db
    .delete(schema.incomeTaxYears)
    .where(eq(schema.incomeTaxYears.id, id))
    .returning({ id: schema.incomeTaxYears.id });
  return gone.length > 0;
}

/**
 * Replace the whole list (a restore). Damaged entries (not an object, a bad year, rate or amount) and repeated years are
 * skipped, at most MAX_INCOME_TAX_YEARS are kept; nothing here throws on bad input. Returns how many were stored.
 */
export async function replaceIncomeTaxYears(db: Db, entries: readonly unknown[]): Promise<number> {
  await db.delete(schema.incomeTaxYears);
  const kept: Omit<IncomeTaxYear, "id">[] = [];
  const seen = new Set<number>();
  for (const e of entries) {
    if (kept.length >= MAX_INCOME_TAX_YEARS) break;
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const known = r.knownAmount ?? null;
    if (!isTaxYear(r.year) || !isIncomeTaxRate(r.rate)) continue;
    if (known !== null && (!Number.isSafeInteger(known) || (known as number) < 0)) continue;
    if ((known as number | null) !== null && (known as number) > MAX_CENTS) continue;
    if (seen.has(r.year)) continue;
    seen.add(r.year);
    kept.push({ year: r.year, rate: r.rate, knownAmount: known as number | null });
  }
  if (kept.length > 0) await db.insert(schema.incomeTaxYears).values(kept);
  return kept.length;
}
