import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "@/lib/categories/defaults";
import { applyAutomatic } from "./auto";
import { catalogLookup, catalogSuggestion } from "./catalog-nl";

describe("catalogLookup", () => {
  it("knows the shops and providers it lists, whatever the casing or the extras", () => {
    expect(catalogLookup("ALBERT HEIJN 1234 ZOETERMEER", null)).toBe("groceries");
    expect(catalogLookup("Thuisbezorgd.nl", null)).toBeNull(); // not a whole-word match: left to the other layers
    expect(catalogLookup("Thuisbezorgd", "Bestelling 123")).toBe("eating-out");
    expect(catalogLookup("NS Reizigers", "Reiskosten")).toBe("transport");
    expect(catalogLookup(null, "Betaling Spotify AB")).toBe("subscriptions");
  });

  it("the longest name wins", () => {
    expect(catalogLookup("Uber Eats", null)).toBe("eating-out");
    expect(catalogLookup("Uber", null)).toBe("transport");
    expect(catalogLookup("AH to go Utrecht", null)).toBe("eating-out");
  });

  it("stays silent about names that are used for everything", () => {
    for (const name of [
      "Bol.com",
      "Amazon",
      "PayPal",
      "Tikkie",
      "Action",
      "HEMA",
      "IKEA",
      "Coolblue",
    ])
      expect(catalogLookup(name, null)).toBeNull();
    // An ambiguous name as long as the match cancels it.
    expect(catalogLookup("Apple", null)).toBeNull();
    expect(catalogLookup("Apple.com Bill", null)).toBe("subscriptions");
  });

  it("covers every starter rule, in the same category", () => {
    const slugOf = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c.slug]));
    const mismatches = DEFAULT_RULES.filter(
      (r) => catalogLookup(r.pattern, null) !== slugOf.get(r.category),
    ).map((r) => r.pattern);
    expect(mismatches).toEqual([]);
  });
});

describe("catalogSuggestion (words that hint at a category without settling it)", () => {
  it("hints that a café is probably Food & drink, but the catalog itself stays silent", () => {
    expect(catalogLookup("Cafe De Hoek", null)).toBeNull();
    expect(catalogLookup("Caffè Roma", null)).toBeNull();
    expect(catalogSuggestion("Cafe De Hoek", null)).toBe("eating-out");
    expect(catalogSuggestion("Caffè Roma", null)).toBe("eating-out");
    expect(catalogSuggestion(null, "Betaling Café Het Hoekje")).toBe("eating-out");
  });
  it("needs the whole word, and says nothing about other names", () => {
    expect(catalogSuggestion("Cafeteria Noord", null)).toBeNull();
    expect(catalogSuggestion("Lidl", null)).toBeNull();
  });
  it("leaves a name the catalog knows to the catalog (an eetcafe is a restaurant)", () => {
    expect(catalogLookup("Eetcafe De Gouden Leeuw", null)).toBe("eating-out");
  });
});

describe("applyAutomatic with the catalog", () => {
  async function setup() {
    const db = await createDb(":memory:");
    const [account] = await db
      .insert(schema.accounts)
      .values({ name: "A", bank: "rabobank" })
      .returning();
    let n = 0;
    const tx = async (
      counterparty: string,
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
    const cat = async (slug: string) =>
      (await one(db.select().from(schema.categories).where(eq(schema.categories.slug, slug))))!.id;
    return { db, tx, get, cat };
  }

  it("categorises what is open, marks it automatic, and leaves the rest alone", async () => {
    const { db, tx, get, cat } = await setup();
    const open = await tx("Basic-Fit Zoetermeer");
    const unknown = await tx("Bakker Piet");
    const done = await tx("Lidl", { categoryId: await cat("sport"), categorySource: "user" });
    expect((await applyAutomatic(db)).applied).toBe(1);
    expect(await get(open.id)).toMatchObject({
      categoryId: await cat("sport"),
      categorySource: "catalog",
    });
    expect((await get(unknown.id)).categoryId).toBeNull();
    expect(await get(done.id)).toMatchObject({ categorySource: "user" }); // the person's choice stays
  });

  it("respects an undo, internal transfers and the direction of the money", async () => {
    const { db, tx, get } = await setup();
    const undone = await tx("Lidl", { categorySource: "undone" });
    const transfer = await tx("Lidl", { isInternalTransfer: true });
    const refundOut = await tx("Salaris Werkgever", { amount: -5000 }); // money out is not a salary
    const salary = await tx("Salaris Werkgever", { amount: 150000 });
    expect((await applyAutomatic(db)).applied).toBe(1);
    expect((await get(undone.id)).categoryId).toBeNull();
    expect((await get(transfer.id)).categoryId).toBeNull();
    expect((await get(refundOut.id)).categoryId).toBeNull();
    expect((await get(salary.id)).categorySource).toBe("catalog");
  });

  it("does nothing for a user whose categories have no slugs (their own categories)", async () => {
    const { db, tx } = await setup();
    await db.update(schema.categories).set({ slug: null });
    await tx("Lidl");
    expect((await applyAutomatic(db)).applied).toBe(0);
  });

  it("offers a café as 'Probably Food & drink?' instead of sorting it", async () => {
    const { db, tx, get, cat } = await setup();
    const cafe = await tx("Cafe De Hoek");
    const result = await applyAutomatic(db);
    expect(result).toMatchObject({ applied: 0, suggested: 1 });
    expect(await get(cafe.id)).toMatchObject({
      categoryId: null,
      suggestedCategoryId: await cat("eating-out"),
    });
  });

  it("lets the person's own history decide a café once they have taught it twice", async () => {
    const { db, tx, get, cat } = await setup();
    const bars = await cat("going-out");
    for (let i = 0; i < 2; i++)
      await tx("Cafe De Hoek", {
        categoryId: bars,
        categorySource: "user",
        merchantKey: "cafe de hoek",
      });
    const again = await tx("Cafe De Hoek", { merchantKey: "cafe de hoek" });
    await applyAutomatic(db);
    expect(await get(again.id)).toMatchObject({ categoryId: bars, categorySource: "history" });
  });

  it("offers what the person taught once before, ahead of the café hint", async () => {
    const { db, tx, get, cat } = await setup();
    const bars = await cat("going-out");
    await tx("Cafe De Hoek", {
      categoryId: bars,
      categorySource: "user",
      merchantKey: "cafe de hoek",
    });
    const again = await tx("Cafe De Hoek", { merchantKey: "cafe de hoek" });
    await applyAutomatic(db);
    expect(await get(again.id)).toMatchObject({ categoryId: null, suggestedCategoryId: bars });
  });

  it("does not suggest a café for money coming in", async () => {
    const { db, tx, get } = await setup();
    const refund = await tx("Cafe De Hoek", { amount: 500 });
    expect(await applyAutomatic(db)).toMatchObject({ applied: 0, suggested: 0 });
    expect((await get(refund.id)).suggestedCategoryId).toBeNull();
  });
});
