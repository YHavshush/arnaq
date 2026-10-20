import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { applyRules, assignCategory } from "@/lib/categories/categorise";
import { applyLearned, ensureMerchantKeys, getLearnedLabels } from "./learned";

async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "A", bank: "rabobank" })
    .returning();
  const cat = async (name: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.name, name))))!.id;
  let n = 0;
  const tx = async (
    counterparty: string | null,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    (await one(
      db
        .insert(schema.transactions)
        .values({
          accountId: account.id,
          date: "2026-10-05",
          amount: -1500,
          counterparty,
          importHash: `h${n++}`,
          ...extra,
        })
        .returning(),
    ))!;
  const get = async (id: number) =>
    (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, id))))!;
  return { db, cat, tx, get };
}

describe("merchant keys", () => {
  it("are filled in for rows that do not have one yet, and left alone afterwards", async () => {
    const { db, tx, get } = await setup();
    const a = await tx("Albert Heijn 1234 Zoetermeer");
    const b = await tx(null, { description: null });
    expect(a.merchantKey).toBeNull();
    expect(await ensureMerchantKeys(db)).toBe(2);
    expect((await get(a.id)).merchantKey).toBe("albert heijn zoetermeer");
    expect((await get(b.id)).merchantKey).toBe(""); // nothing to go on, but not looked at again
    expect(await ensureMerchantKeys(db)).toBe(0);
  });
});

describe("teaching a shop", () => {
  it("a correction with learn remembers the shop and applies it to the same shop next time", async () => {
    const { db, cat, tx, get } = await setup();
    const groceries = await cat("Boodschappen");
    const first = await tx("Spar City 1234 Utrecht");
    const result = await assignCategory(db, first.id, groceries, { learn: true });
    expect(result).toEqual({ ruleId: null, alsoCategorised: 0 });
    expect(await get(first.id)).toMatchObject({
      categorySource: "user",
      merchantKey: "spar city utrecht",
    });
    expect((await getLearnedLabels(db)).get("spar city utrecht")).toBe(groceries);

    // The same shop, written differently, on a later import.
    const later = await tx("SPAR CITY 9999 Utrecht", { merchantKey: "spar city utrecht" });
    const other = await tx("Spar City Delft", { merchantKey: "spar city delft" });
    expect(await applyLearned(db)).toBe(1);
    expect(await get(later.id)).toMatchObject({ categoryId: groceries, categorySource: "learned" });
    expect((await get(other.id)).categoryId).toBeNull();
  });

  it("without learn nothing is remembered", async () => {
    const { db, cat, tx } = await setup();
    const t = await tx("Spar City");
    await assignCategory(db, t.id, await cat("Boodschappen"));
    expect((await getLearnedLabels(db)).size).toBe(0);
  });

  it("a correction replaces what a machine decided for the same shop, never the person's own choice", async () => {
    const { db, cat, tx, get } = await setup();
    const groceries = await cat("Boodschappen");
    const eating = await cat("Eten & drinken");
    const sport = await cat("Sport");
    const key = "cafe de hoek";
    const guessed = await tx("Cafe De Hoek", {
      merchantKey: key,
      categoryId: groceries,
      categorySource: "model",
    });
    const catalog = await tx("Cafe De Hoek", {
      merchantKey: key,
      categoryId: groceries,
      categorySource: "catalog",
    });
    const mine = await tx("Cafe De Hoek", {
      merchantKey: key,
      categoryId: sport,
      categorySource: "user",
    });
    const open = await tx("Cafe De Hoek", { merchantKey: key });
    const trigger = await tx("Cafe De Hoek", {
      merchantKey: key,
      categoryId: groceries,
      categorySource: "model",
    });

    const result = await assignCategory(db, trigger.id, eating, { learn: true });
    expect(result.alsoCategorised).toBe(3);
    for (const id of [guessed.id, catalog.id, open.id])
      expect(await get(id)).toMatchObject({ categoryId: eating, categorySource: "learned" });
    expect(await get(mine.id)).toMatchObject({ categoryId: sport, categorySource: "user" });
    expect(await get(trigger.id)).toMatchObject({ categoryId: eating, categorySource: "user" });
  });

  it("a later correction changes the remembered category", async () => {
    const { db, cat, tx } = await setup();
    const t1 = await tx("Spar City");
    const t2 = await tx("Spar City");
    await assignCategory(db, t1.id, await cat("Boodschappen"), { learn: true });
    await assignCategory(db, t2.id, await cat("Eten & drinken"), { learn: true });
    expect((await getLearnedLabels(db)).get("spar city")).toBe(await cat("Eten & drinken"));
  });

  it("rules say where a category came from", async () => {
    const { db, tx, get } = await setup();
    const t = await tx("Jumbo Supermarkten 12");
    expect(await applyRules(db)).toBe(1);
    expect(await get(t.id)).toMatchObject({ categorySource: "rule" });
  });
});

describe("teaching a transfer between the person's own accounts", () => {
  it("is remembered per direction: a top-up is a transfer, a purchase from the same name is not", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const topUp = await tx("Apple Pay", { amount: 20000 });
    await assignCategory(db, topUp.id, transfer, { learn: true });
    expect(await get(topUp.id)).toMatchObject({ isInternalTransfer: true, categoryId: transfer });

    const nextTopUp = await tx("Apple Pay", { amount: 5000, date: "2026-11-02" });
    const purchase = await tx("Apple Pay", { amount: -1099, date: "2026-11-03" });
    expect(await applyLearned(db)).toBe(1);
    expect(await get(nextTopUp.id)).toMatchObject({
      isInternalTransfer: true,
      categoryId: transfer,
      categorySource: "learned",
    });
    expect(await get(purchase.id)).toMatchObject({ isInternalTransfer: false, categoryId: null });
  });

  it("also moves the other open transactions of the same direction, and leaves the other direction", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const first = await tx("Apple Pay", { amount: 20000 });
    const sameWay = await tx("Apple Pay", { amount: 7000, date: "2026-10-09" });
    const otherWay = await tx("Apple Pay", { amount: -700, date: "2026-10-10" });
    await ensureMerchantKeys(db);
    const result = await assignCategory(db, first.id, transfer, { learn: true });
    expect(result.alsoCategorised).toBe(1);
    expect(await get(sameWay.id)).toMatchObject({ isInternalTransfer: true, categoryId: transfer });
    expect(await get(otherWay.id)).toMatchObject({ isInternalTransfer: false, categoryId: null });
  });

  it("choosing another category for that direction later replaces the transfer memory", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const salary = await cat("Salaris / bijbaan");
    const a = await tx("Werkgever BV", { amount: 150000 });
    await assignCategory(db, a.id, transfer, { learn: true });
    const b = await tx("Werkgever BV", { amount: 150000, date: "2026-11-01" });
    await assignCategory(db, b.id, salary, { learn: true });
    expect(await get(b.id)).toMatchObject({ isInternalTransfer: false, categoryId: salary });

    const c = await tx("Werkgever BV", { amount: 150000, date: "2026-12-01" });
    expect(await applyLearned(db)).toBe(1);
    expect(await get(c.id)).toMatchObject({ isInternalTransfer: false, categoryId: salary });
  });

  it("without learn, only that transaction is a transfer", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const a = await tx("Revolut", { amount: -20000 });
    await assignCategory(db, a.id, transfer);
    const b = await tx("Revolut", { amount: -20000, date: "2026-11-01" });
    expect(await applyLearned(db)).toBe(0);
    expect(await get(b.id)).toMatchObject({ isInternalTransfer: false, categoryId: null });
    expect((await getLearnedLabels(db)).size).toBe(0);
  });

  it("a transaction of zero euro has no direction and is never flagged by a remembered transfer", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const first = await tx("Apple Pay", { amount: -500 });
    await assignCategory(db, first.id, transfer, { learn: true });
    const check = await tx("Apple Pay", { amount: 0, date: "2026-11-01" });
    expect(await applyLearned(db)).toBe(0);
    expect(await get(check.id)).toMatchObject({ isInternalTransfer: false, categoryId: null });
  });

  it("putting one back also releases the others that were only transfers because of the memory", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const salary = await cat("Salaris / bijbaan");
    const a = await tx("Werkgever BV", { amount: 150000 });
    const b = await tx("Werkgever BV", { amount: 150000, date: "2026-11-01" });
    const chosen = await tx("Werkgever BV", { amount: 150000, date: "2026-12-01" });
    await ensureMerchantKeys(db);
    await assignCategory(db, chosen.id, transfer); // chosen by hand, no memory
    await assignCategory(db, a.id, transfer, { learn: true }); // b follows through the memory
    expect(await get(b.id)).toMatchObject({ isInternalTransfer: true, categorySource: "learned" });

    await assignCategory(db, a.id, salary, { learn: true });
    expect(await get(a.id)).toMatchObject({ isInternalTransfer: false, categoryId: salary });
    expect(await get(b.id)).toMatchObject({ isInternalTransfer: false, categoryId: salary });
    expect(await get(chosen.id)).toMatchObject({ isInternalTransfer: true, categoryId: transfer });
  });
});

describe("remembering reaches rows that have no shop key yet", () => {
  it("older rows (imported before keys existed) follow the correction without a manual fix-up", async () => {
    const { db, cat, tx, get } = await setup();
    const transfer = await cat("Interne overboeking");
    const first = await tx("From Instant Access Savings", { amount: 20000 });
    const older = await tx("From Instant Access Savings", { amount: 15000, date: "2026-08-12" });
    expect((await get(older.id)).merchantKey).toBeNull(); // as after the migration: no key yet
    const result = await assignCategory(db, first.id, transfer, { learn: true });
    expect(result.alsoCategorised).toBe(1);
    expect(await get(older.id)).toMatchObject({ isInternalTransfer: true, categoryId: transfer });
  });
});
