import { and, eq, gte, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getBtwSettings } from "@/lib/btw/settings";
import { mentions } from "@/lib/btw/words";
import { addMonths } from "@/lib/recurring/dates";
import { getIncomeTaxSettings } from "./settings";
import { getIncomeTaxYears, type IncomeTaxYear } from "./years";

/**
 * What the income tax reserve needs to know, read once: is it working at all, which years count, and the pocket words.
 *
 * It is active only when it is on AND at least one tax year has a rate above 0 or a known amount. Otherwise nothing
 * changes anywhere: no share, no card, no forecast line, the pocket word marks nothing and the savings stay as they were.
 * That is how every account starts (no tax years).
 */
export interface IncomeTaxState {
  active: boolean;
  on: boolean;
  /** The tax years that count (rate above 0 or a known amount), oldest first; empty when not active. */
  years: IncomeTaxYear[];
  /** The income tax pocket word; null when not active (then no move is income tax money). */
  pocket: string | null;
  /** The BTW pocket word: a move that names it is BTW money, never income tax. */
  btwPocket: string;
  potInSavings: boolean;
}

export const countsYear = (y: Pick<IncomeTaxYear, "rate" | "knownAmount">) =>
  y.rate > 0 || y.knownAmount !== null;

export async function loadIncomeTax(db: Db): Promise<IncomeTaxState> {
  const settings = await getIncomeTaxSettings(db);
  const years = settings.on ? (await getIncomeTaxYears(db)).filter(countsYear) : [];
  const active = years.length > 0;
  return {
    active,
    on: settings.on,
    years,
    pocket: active ? settings.pocket : null,
    btwPocket: (await getBtwSettings(db)).pocket,
    potInSavings: active && settings.potInSavings,
  };
}

/** The rate (basis points) for a calendar year; 0 when the year has none. */
export function rateFor(state: Pick<IncomeTaxState, "years">, year: number): number {
  return state.years.find((y) => y.year === year)?.rate ?? 0;
}

/**
 * A move to savings is income tax money when it names the income tax pocket word and not the BTW pocket word (a move
 * that names the BTW pocket stays BTW money, as it always was). Nothing is, while the reserve is not active.
 */
export function isIncomeTaxPocketMove(
  r: { counterparty: string | null; description: string | null },
  state: Pick<IncomeTaxState, "pocket" | "btwPocket">,
): boolean {
  if (state.pocket === null) return false;
  const text = [r.counterparty, r.description];
  return mentions(text, state.pocket) && !mentions(text, state.btwPocket);
}

/**
 * The net money moved into the income tax pocket (cents): moves in minus moves back out, from `from` up to `to`
 * (YYYY-MM-DD, `to` excluded) or over all time. Only moves on the savings category, in the account's own currency.
 */
export async function incomeTaxPocketMoves(
  db: Db,
  state: Pick<IncomeTaxState, "pocket" | "btwPocket">,
  range: { from?: string; to?: string } = {},
): Promise<number> {
  if (state.pocket === null) return 0;
  const t = schema.transactions;
  const where = [eq(t.currency, schema.accounts.currency), eq(schema.categories.type, "savings")];
  if (range.from) where.push(gte(t.date, range.from));
  if (range.to) where.push(lt(t.date, range.to));
  const rows = await db
    .select({ amount: t.amount, counterparty: t.counterparty, description: t.description })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .innerJoin(schema.categories, eq(schema.categories.id, t.categoryId))
    .where(and(...where));
  return rows.filter((r) => isIncomeTaxPocketMove(r, state)).reduce((s, r) => s - r.amount, 0);
}

/** The net money moved into the income tax pocket in a month: on Today it counts as the share set aside. */
export async function incomeTaxMovedIn(db: Db, opts: { month: string }): Promise<number> {
  const state = await loadIncomeTax(db);
  return await incomeTaxPocketMoves(db, state, {
    from: `${opts.month}-01`,
    to: `${addMonths(opts.month, 1)}-01`,
  });
}
