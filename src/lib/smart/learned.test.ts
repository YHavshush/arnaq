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
