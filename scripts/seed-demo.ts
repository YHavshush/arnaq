// Fills the LOCAL database with made-up data so the dashboard can be looked at.
// Everything here is synthetic (invented names, IBANs and amounts). Never run it against a real database:
//   npm run seed:demo        (uses ./data/pglite, or DATABASE_URL if set to a local server)
import { createHash } from "node:crypto";
import { count } from "drizzle-orm";
import { createDb, schema } from "../src/db";
import { setBudget, setTotalBudget } from "../src/lib/budget/budgets";
import { applyRules } from "../src/lib/categories/categorise";
import { detectInternalTransfers } from "../src/lib/categories/transfers";
import { addMonths, clampDay } from "../src/lib/recurring/dates";
import { createRecurringItem } from "../src/lib/recurring/items";
import { syncRecurring } from "../src/lib/recurring/sync";
import { todayIso } from "../src/lib/api";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (url && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error("Refusing to seed demo data into a non-local DATABASE_URL.");
    process.exit(1);
  }
  const db = await createDb(url || "./data/pglite");
  const [{ n }] = await db.select({ n: count() }).from(schema.transactions);
  if (n > 0 && process.env.FORCE !== "1") {
    console.error("The database already has transactions. Set FORCE=1 to add demo data anyway.");
    process.exit(1);
  }

  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const [rabo] = await db
    .insert(schema.accounts)
    .values({ name: "Rabobank betaalrekening", bank: "rabobank", iban: "NL00RABO0000000001" })
    .returning();
  const cats = new Map((await db.select().from(schema.categories)).map((c) => [c.name, c.id]));
  const cat = (name: string) => {
    const id = cats.get(name);
    if (id === undefined) throw new Error(`Unknown category ${name}`);
    return id;
  };

  let seed = 42;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

  const rows: (typeof schema.transactions.$inferInsert)[] = [];
  const add = (date: string, cents: number, counterparty: string, description = "") => {
    if (date > today) return;
    const importHash = createHash("sha256")
      .update(`${date}|${cents}|${counterparty}|${rows.length}`)
      .digest("hex");
    rows.push({ accountId: rabo.id, date, amount: cents, counterparty, description, importHash });
  };

  for (let back = 4; back >= 0; back--) {
    const m = addMonths(thisMonth, -back);
    const d = (day: number) => clampDay(m, day);
    add(d(1), -79000, "Verhuurder Voorbeeld", "Huur");
    add(d(1), -13200, "Zilveren Kruis", "Zorgverzekering");
    add(d(5), -2999, "Basic-Fit", "Abonnement");
    add(d(10), -1099, "Spotify", "Premium");
    add(d(18), -3500, "Ziggo", "Internet");
    add(d(25), 185000, "Werkgever Voorbeeld BV", "Salaris");
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
  await db.insert(schema.transactions).values(rows);
  for (let back = 4; back >= 0; back--)
    await db.insert(schema.imports).values({
      accountId: rabo.id,
      month: addMonths(thisMonth, -back),
      filename: `demo-${addMonths(thisMonth, -back)}.csv`,
      rowsTotal: 0,
      rowsImported: 0,
    });

  await detectInternalTransfers(db);
  await applyRules(db);

  const item = (
    name: string,
    cents: number,
    day: number,
    category: string,
    counterparty: string,
    type: "expense" | "income" = "expense",
  ) =>
    createRecurringItem(
      db,
      {
        name,
        type,
        matchCounterparty: counterparty,
        expectedAmount: cents,
        dayOfMonth: day,
        categoryId: cat(category),
        startDate: `${addMonths(thisMonth, -4)}-01`,
        tolerance: 200,
      },
      { today },
    );
  await item("Huur", 79000, 1, "Huur", "Verhuurder Voorbeeld");
  await item("Zorgverzekering", 13200, 1, "Zorgverzekering", "Zilveren Kruis");
  await item("Sportschool", 2999, 5, "Sport", "Basic-Fit");
  await item("Spotify", 1099, 10, "Abonnementen", "Spotify");
  await item("Internet", 3500, 18, "Internet & telefoon", "Ziggo");
  await item("Salaris", 185000, 25, "Salaris / bijbaan", "Werkgever Voorbeeld BV", "income");

  for (const [name, euros] of [
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
  ] as const) {
    for (let back = 4; back >= -3; back--)
      await setBudget(db, cat(name), addMonths(thisMonth, -back), euros * 100);
  }
  for (let back = 4; back >= -3; back--)
    await setTotalBudget(db, addMonths(thisMonth, -back), 175000);
  await syncRecurring(db, { throughMonth: addMonths(thisMonth, 6), today });
  console.log(`Demo data added: ${rows.length} transactions.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seeding failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
