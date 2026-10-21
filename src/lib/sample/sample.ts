import { createHash } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { setBudget, setTotalBudget } from "@/lib/budget/budgets";
import { applyRules } from "@/lib/categories/categorise";
import { detectInternalTransfers } from "@/lib/categories/transfers";
import { addMonths, clampDay } from "@/lib/recurring/dates";
import { createRecurringItem } from "@/lib/recurring/items";
import { syncRecurring } from "@/lib/recurring/sync";

/**
 * Sample data: a made-up account with a few months of invented payments, fixed items and budgets, so
 * a new person can look around before uploading anything. Everything here is synthetic (invented
 * shops, an invented IBAN, invented amounts). It lives in the person's own account like any other
 * data, marked by the sample account's identifier, and is removed in one step ("use my own").
 */
export class SampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleError";
  }
}

/** Marks the sample account. Not a real IBAN, so it can never collide with one. */
export const SAMPLE_IBAN = "SAMPLE-DATA";

/** Months of history the sample covers, counting the current month. */
const MONTHS_BACK = 4;

type Item = {
  name: string;
  cents: number;
  day: number;
  category: string;
  counterparty: string;
  type: "expense" | "income";
};

/** The fixed items. `clearSample` removes exactly these (same name, shop and amount), never a person's own. */
export const SAMPLE_ITEMS: Item[] = [
  {
    name: "Huur",
    cents: 79000,
    day: 1,
    category: "Huur",
    counterparty: "Verhuurder Voorbeeld",
    type: "expense",
  },
  {
    name: "Zorgverzekering",
    cents: 13200,
    day: 1,
    category: "Zorgverzekering",
    counterparty: "Zilveren Kruis",
    type: "expense",
  },
  {
    name: "Sportschool",
    cents: 2999,
    day: 5,
    category: "Sport",
    counterparty: "Basic-Fit",
    type: "expense",
  },
  {
    name: "Spotify",
    cents: 1099,
    day: 10,
    category: "Abonnementen",
    counterparty: "Spotify",
    type: "expense",
  },
  {
    name: "Internet",
    cents: 3500,
    day: 18,
    category: "Internet & telefoon",
    counterparty: "Ziggo",
    type: "expense",
  },
  {
    name: "Salaris",
    cents: 185000,
    day: 25,
    category: "Salaris / bijbaan",
    counterparty: "Werkgever Voorbeeld BV",
    type: "income",
  },
];

/** Monthly budgets per category, in whole euros, and the total for the month in cents. */
export const SAMPLE_BUDGETS: [string, number][] = [
  ["Huur", 790],
  ["Zorgverzekering", 132],
  ["Boodschappen", 280],
  ["Eten & drinken", 110],
  ["Uitgaan & social", 90],
  ["Vervoer", 60],
  ["Sport", 30],
  ["Abonnementen", 25],
  ["Internet & telefoon", 35],
  ["Kleding & verzorging", 60],
];
export const SAMPLE_TOTAL_BUDGET = 175000;

/** Where each invented shop belongs, for the ones the starter rules do not already know. */
const SHOP_CATEGORY: Record<string, string> = {
  "Albert Heijn": "Boodschappen",
  Jumbo: "Boodschappen",
  Lidl: "Boodschappen",
  Thuisbezorgd: "Eten & drinken",
  Starbucks: "Eten & drinken",
  "McDonald's": "Eten & drinken",
  "NS Reizigers": "Vervoer",
  "Cafe De Hoek": "Uitgaan & social",
  "Bioscoop City": "Uitgaan & social",
  "Bol.com": "Kleding & verzorging",
  Etsy: "Kleding & verzorging",
};

const sampleAccount = async (db: Db) =>
  (await db.select().from(schema.accounts).where(eq(schema.accounts.iban, SAMPLE_IBAN)))[0];

/** Is there sample data in this person's account? */
export async function hasSample(db: Db): Promise<boolean> {
  return (await sampleAccount(db)) !== undefined;
}

/**
 * Fill the account with sample data. Only for an account with no transactions at all, so sample and
 * real data never mix. Loading twice is a no-op. Returns how many transactions were added.
 */
export async function loadSample(db: Db, today: string): Promise<{ transactions: number }> {
  return await db.transaction(async (tx) => {
    if (await sampleAccount(tx)) return { transactions: 0 };
    const [{ n }] = await tx.select({ n: count() }).from(schema.transactions);
    if (n > 0) throw new SampleError("Sample data can only be added to an empty account.");

    const thisMonth = today.slice(0, 7);
    const [account] = await tx
      .insert(schema.accounts)
      .values({ name: "Sample account", bank: "rabobank", iban: SAMPLE_IBAN })
      .returning();
    const cats = new Map((await tx.select().from(schema.categories)).map((c) => [c.name, c.id]));
    const cat = (name: string) => {
      const id = cats.get(name);
      if (id === undefined) throw new SampleError(`Unknown category ${name}`);
      return id;
    };

    // A small deterministic generator, so the sample looks the same every time it is loaded.
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

    const rows: (typeof schema.transactions.$inferInsert)[] = [];
    const add = (date: string, cents: number, counterparty: string, description = "") => {
      if (date > today) return;
      const importHash = createHash("sha256")
        .update(`sample|${date}|${cents}|${counterparty}|${rows.length}`)
        .digest("hex");
      rows.push({
        accountId: account.id,
        date,
        amount: cents,
        counterparty,
        description,
        importHash,
      });
    };

    for (let back = MONTHS_BACK; back >= 0; back--) {
      const m = addMonths(thisMonth, -back);
      const d = (day: number) => clampDay(m, day);
      for (const it of SAMPLE_ITEMS)
        add(d(it.day), it.type === "income" ? it.cents : -it.cents, it.counterparty, it.name);
      for (let i = 0; i < 9; i++)
        add(
          d(2 + Math.floor(rnd() * 26)),
          -Math.round(1200 + rnd() * 5200),
          pick(["Albert Heijn", "Jumbo", "Lidl"]),
        );
      for (let i = 0; i < 5; i++)
        add(
          d(2 + Math.floor(rnd() * 26)),
          -Math.round(900 + rnd() * 3000),
          pick(["Thuisbezorgd", "Starbucks", "McDonald's"]),
        );
      for (let i = 0; i < 3; i++)
        add(d(3 + Math.floor(rnd() * 25)), -Math.round(1500 + rnd() * 4500), "NS Reizigers");
      for (let i = 0; i < 3; i++)
        add(
          d(3 + Math.floor(rnd() * 25)),
          -Math.round(1500 + rnd() * 6000),
          pick(["Cafe De Hoek", "Bioscoop City", "Bol.com", "Etsy"]),
        );
    }
    await tx.insert(schema.transactions).values(rows);
    for (let back = MONTHS_BACK; back >= 0; back--)
      await tx.insert(schema.imports).values({
        accountId: account.id,
        month: addMonths(thisMonth, -back),
        filename: `sample-${addMonths(thisMonth, -back)}.csv`,
        rowsTotal: 0,
        rowsImported: 0,
      });

    await detectInternalTransfers(tx);
    await applyRules(tx);
    // A sample should look finished: whatever the rules did not know is sorted by the table above.
    for (const [shop, category] of Object.entries(SHOP_CATEGORY))
      await tx
        .update(schema.transactions)
        .set({ categoryId: cat(category), categorySource: "rule" })
        .where(
          and(eq(schema.transactions.counterparty, shop), isNull(schema.transactions.categoryId)),
        );

    for (const it of SAMPLE_ITEMS)
      await createRecurringItem(
        tx,
        {
          name: it.name,
          type: it.type,
          matchCounterparty: it.counterparty,
          expectedAmount: it.cents,
          dayOfMonth: it.day,
          categoryId: cat(it.category),
          startDate: `${addMonths(thisMonth, -MONTHS_BACK)}-01`,
          tolerance: 200,
        },
        { today },
      );
    for (const [name, euros] of SAMPLE_BUDGETS)
      for (let back = MONTHS_BACK; back >= -3; back--)
        await setBudget(tx, cat(name), addMonths(thisMonth, -back), euros * 100);
    for (let back = MONTHS_BACK; back >= -3; back--)
      await setTotalBudget(tx, addMonths(thisMonth, -back), SAMPLE_TOTAL_BUDGET);
    await syncRecurring(tx, { throughMonth: addMonths(thisMonth, 6), today });
    return { transactions: rows.length };
  });
}

/**
 * Remove the sample data in one go: the sample account with its transactions and imports, the fixed
 * items and budgets the sample created. Anything the person made themselves survives: a fixed item or
 * budget is removed only when it is exactly the sample's (a changed one is theirs now).
 * Returns whether there was any sample data.
 */
export async function clearSample(db: Db): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const account = await sampleAccount(tx);
    if (!account) return false;

    const sampleTx = tx
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(eq(schema.transactions.accountId, account.id));
    // Transactions point at occurrences and occurrences at transactions: break the link first.
    await tx
      .update(schema.transactions)
      .set({ matchedOccurrenceId: null })
      .where(inArray(schema.transactions.id, sampleTx));

    const items = await tx.select().from(schema.recurringItems);
    const ours = items.filter((i) =>
      SAMPLE_ITEMS.some(
        (s) =>
          s.name === i.name &&
          s.counterparty === i.matchCounterparty &&
          s.cents === i.expectedAmount &&
          s.type === i.type,
      ),
    );
    if (ours.length)
      await tx.delete(schema.recurringItems).where(
        inArray(
          schema.recurringItems.id,
          ours.map((i) => i.id),
        ),
      );

    await tx.delete(schema.transactions).where(eq(schema.transactions.accountId, account.id));
    await tx.delete(schema.imports).where(eq(schema.imports.accountId, account.id));
    await tx.delete(schema.accounts).where(eq(schema.accounts.id, account.id));

    const cats = new Map((await tx.select().from(schema.categories)).map((c) => [c.name, c.id]));
    for (const [name, euros] of SAMPLE_BUDGETS) {
      const id = cats.get(name);
      if (id !== undefined)
        await tx
          .delete(schema.budgets)
          .where(and(eq(schema.budgets.categoryId, id), eq(schema.budgets.amount, euros * 100)));
    }
    await tx
      .delete(schema.monthlyTotalBudget)
      .where(eq(schema.monthlyTotalBudget.amount, SAMPLE_TOTAL_BUDGET));
    return true;
  });
}

/** Can sample data be offered here? Only for an account with no transactions and no sample yet. */
export async function canLoadSample(db: Db): Promise<boolean> {
  if (await sampleAccount(db)) return false;
  const [{ n }] = await db.select({ n: count() }).from(schema.transactions);
  return n === 0;
}
