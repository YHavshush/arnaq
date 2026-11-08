import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
// The schema module itself, not "@/db": seedDefaults (which @/db loads) seeds the default client from here.
import * as schema from "@/db/schema";
import {
  DEFAULT_BTW_INCOME_MATCH,
  DEFAULT_BTW_PAYMENT_LAG,
  MAX_BTW_CLIENTS,
  isBtwPaymentLag,
  type BtwPaymentLag,
} from "./defaults";
import { BTW_RATE_PERCENT, isBtwVatPercent, type BtwVatPercent } from "./rate";
import { BtwError, cleanBtwName } from "./names";
import { words } from "./words";

/**
 * The person's BTW clients: which money that comes in carries BTW, which quarter it counts for, and at what rate.
 *
 * Every place that asks "is this payment BTW income, and whose?" goes through btwClientMatcher (payments) or
 * btwClientOfItem (fixed income items, which uses the same matcher): the quarter card, the monthly share, the plan
 * grid's BTW row, Today's taxes row and the forecast. So they cannot drift apart.
 *
 * Today an entry is always a client named on the statement. A later kind of entry (for example "everything that comes
 * in on this bank account") would be another rule tried inside btwClientMatcher; see the note there.
 */

export { MAX_BTW_CLIENTS };

/** What a client is (without its id): enough to match and count its money. */
export interface BtwClientRule {
  /** What the client is called on the statement (matched as whole words). */
  name: string;
  /** How many months after the invoice this client usually pays (see btwReceiptWindow). */
  paymentLag: BtwPaymentLag;
  /** 21: the standard rate; 0: no BTW charged (their money adds nothing to the BTW). */
  vatPercent: BtwVatPercent;
}

export interface BtwClient extends BtwClientRule {
  id: number;
}

/** What a payment says about who sent it. */
export interface BtwPayment {
  counterparty: string | null;
  description: string | null;
}

/** An edit or delete for a client the person does not have (the route answers 404). */
export class BtwClientNotFound extends Error {
  constructor() {
    super("BTW client not found.");
  }
}

/**
 * Which client a payment is from, or null when it is not BTW income: the one function that decides it.
 *
 * A client matches when its name appears as whole words (any case, any accents) in the payment's counterparty or
 * description. When several match, the longest name wins ("Acme Consulting" over "Acme"; length counted on the name
 * as matched: lower case, punctuation as spaces), and with names of the same length the oldest client (lowest id; the
 * one listed first when there are no ids) wins.
 *
 * A future rule such as "everything that comes in on this bank account counts" would be a second kind of entry with an
 * account id instead of a name: BtwPayment gets the payment's accountId, and this function tries the account entries
 * first (an account says more than a name), then the names. Every caller already goes through here.
 */
export function btwClientMatcher<C extends BtwClientRule & { id?: number }>(
  clients: readonly C[],
): (payment: BtwPayment) => C | null {
  const byLength = clients
    .map((client, order) => ({ client, order, needle: words(client.name) }))
    // An empty needle (" ") would match everything; names always have a letter or digit, but be safe.
    .filter((c) => c.needle.trim() !== "")
    .sort(
      (a, b) =>
        b.needle.length - a.needle.length ||
        (a.client.id ?? a.order) - (b.client.id ?? b.order) ||
        a.order - b.order,
    );
  return (payment) => {
    const text = words([payment.counterparty, payment.description].filter(Boolean).join(" "));
    return byLength.find((c) => text.includes(c.needle))?.client ?? null;
  };
}

/** The client a fixed income item is from: judged by its counterparty, or by its name when it has none. */
export function btwClientOfItem<C extends BtwClientRule>(
  match: (payment: BtwPayment) => C | null,
  item: { matchCounterparty: string | null; name: string },
): C | null {
  return match({ counterparty: item.matchCounterparty ?? item.name, description: null });
}

const columns = {
  id: schema.btwClients.id,
  name: schema.btwClients.name,
  paymentLag: schema.btwClients.paymentLag,
  vatPercent: schema.btwClients.vatPercent,
};

/** A stored row as a client; the database checks keep these in range, the fallbacks only satisfy the types. */
function toClient(r: { id: number; name: string; paymentLag: number; vatPercent: number }) {
  return {
    id: r.id,
    name: r.name,
    paymentLag: isBtwPaymentLag(r.paymentLag) ? r.paymentLag : DEFAULT_BTW_PAYMENT_LAG,
    vatPercent: isBtwVatPercent(r.vatPercent) ? r.vatPercent : BTW_RATE_PERCENT,
  } satisfies BtwClient;
}

/** The person's clients, oldest first (the order the matcher breaks ties in). */
export async function getBtwClients(db: Db): Promise<BtwClient[]> {
  const rows = await db.select(columns).from(schema.btwClients).orderBy(asc(schema.btwClients.id));
  return rows.map(toClient);
}

/** The person's clients and the matcher over them, for code that matches many payments or items. */
export async function loadBtwMatcher(db: Db) {
  const clients = await getBtwClients(db);
  return { clients, match: btwClientMatcher(clients) };
}

function readName(v: unknown): string {
  const name = typeof v === "string" ? cleanBtwName(v) : null;
  if (name === null) throw new BtwError("Give the client a name.");
  return name;
}
function readLag(v: unknown): BtwPaymentLag {
  if (!isBtwPaymentLag(v)) throw new BtwError("The payment lag must be 0, 1 or 2 months.");
  return v;
}
function readRate(v: unknown): BtwVatPercent {
  if (!isBtwVatPercent(v)) throw new BtwError("The BTW rate must be 21% or 0%.");
  return v;
}

async function assertNameFree(db: Db, name: string, exceptId?: number) {
  const same = sql`lower(${schema.btwClients.name}) = lower(${name})`;
  const [taken] = await db
    .select({ id: schema.btwClients.id })
    .from(schema.btwClients)
    .where(exceptId === undefined ? same : and(same, ne(schema.btwClients.id, exceptId)))
    .limit(1);
  if (taken) throw new BtwError("You already have a client with this name.");
}

/** Add a client. The name is needed; the lag defaults to 0 and the rate to 21%. */
export async function addBtwClient(
  db: Db,
  input: { name?: unknown; paymentLag?: unknown; vatPercent?: unknown },
): Promise<BtwClient> {
  const name = readName(input.name);
  const paymentLag =
    input.paymentLag === undefined ? DEFAULT_BTW_PAYMENT_LAG : readLag(input.paymentLag);
  const vatPercent = input.vatPercent === undefined ? BTW_RATE_PERCENT : readRate(input.vatPercent);
  const [{ n }] = await db.select({ n: count() }).from(schema.btwClients);
  if (n >= MAX_BTW_CLIENTS) throw new BtwError(`You can have up to ${MAX_BTW_CLIENTS} clients.`);
  await assertNameFree(db, name);
  const [row] = await db
    .insert(schema.btwClients)
    .values({ name, paymentLag, vatPercent })
    .returning(columns);
  return toClient(row);
}

/** Change a client; a field left out is kept. Throws BtwClientNotFound for an id the person does not have. */
export async function updateBtwClient(
  db: Db,
  id: number,
  input: { name?: unknown; paymentLag?: unknown; vatPercent?: unknown },
): Promise<BtwClient> {
  const values: { name?: string; paymentLag?: BtwPaymentLag; vatPercent?: BtwVatPercent } = {};
  if (input.name !== undefined) values.name = readName(input.name);
  if (input.paymentLag !== undefined) values.paymentLag = readLag(input.paymentLag);
  if (input.vatPercent !== undefined) values.vatPercent = readRate(input.vatPercent);
  if (values.name !== undefined) await assertNameFree(db, values.name, id);
  const where = eq(schema.btwClients.id, id);
  const [row] =
    Object.keys(values).length > 0
      ? await db.update(schema.btwClients).set(values).where(where).returning(columns)
      : await db.select(columns).from(schema.btwClients).where(where);
  if (!row) throw new BtwClientNotFound();
  return toClient(row);
}

/** Remove a client; false when the person has no client with this id. The last one can go too. */
export async function deleteBtwClient(db: Db, id: number): Promise<boolean> {
  const gone = await db
    .delete(schema.btwClients)
    .where(eq(schema.btwClients.id, id))
    .returning({ id: schema.btwClients.id });
  return gone.length > 0;
}

/**
 * Replace the whole list (a restore). Entries that are damaged (not an object, a bad name, lag or rate) or repeat a
 * name already taken are skipped, and at most MAX_BTW_CLIENTS are kept; nothing here throws on bad input. Returns how
 * many were stored.
 */
export async function replaceBtwClients(db: Db, entries: readonly unknown[]): Promise<number> {
  await db.delete(schema.btwClients);
  const kept: BtwClientRule[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (kept.length >= MAX_BTW_CLIENTS) break;
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    let name: string;
    try {
      name = readName(r.name);
    } catch (err) {
      if (err instanceof BtwError) continue;
      throw err;
    }
    if (!isBtwPaymentLag(r.paymentLag) || !isBtwVatPercent(r.vatPercent)) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    kept.push({ name, paymentLag: r.paymentLag, vatPercent: r.vatPercent });
  }
  if (kept.length > 0) await db.insert(schema.btwClients).values(kept);
  return kept.length;
}

/**
 * A new person (or one who erased everything) starts with the default client, paid in the month of the invoice, at
 * 21%: what arnaq always did without settings. Only when they have no clients, so deleting one sticks.
 */
export async function seedBtwClients(db: Db): Promise<void> {
  // Their own rows only, also when run as the database owner (which row level security does not hold back): the test
  // template is seeded that way, next to the clients migration 0013 gave other people.
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.btwClients)
    .where(sql`${schema.btwClients.userId} = app.uid()`);
  if (n > 0) return;
  await db.insert(schema.btwClients).values({
    name: DEFAULT_BTW_INCOME_MATCH,
    paymentLag: DEFAULT_BTW_PAYMENT_LAG,
    vatPercent: BTW_RATE_PERCENT,
  });
}
