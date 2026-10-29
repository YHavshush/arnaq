import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { applyAutomatic } from "./auto";
import { decide } from "./decide";
import { historyLookup, similarity, type HistoryEntry } from "./history";

describe("similarity", () => {
  it("is 1 for the same text, 0 for nothing in common, and high for a near miss", () => {
    expect(similarity("albert heijn", "albert heijn")).toBe(1);
    expect(similarity("albert heijn", "xyz qwv")).toBe(0);
    expect(similarity("", "albert")).toBe(0);
    expect(similarity("albert heijn zoetermeer", "albert heijn delft")).toBeGreaterThan(0.6);
    expect(similarity("albert heijn", "jumbo")).toBeLessThan(0.3);
  });
});

const entry = (key: string, categoryId: number, count: number): HistoryEntry => ({
  key,
  categoryId,
  count,
});

describe("historyLookup", () => {
  it("strong: a nearly identical shop, enough transactions, everyone agrees", () => {
    const h = [entry("zonnebloem de hoek", 1, 3), entry("zonnebloem de hoeken", 1, 1)];
    expect(historyLookup("zonnebloem de hoek", h)).toEqual({ strong: 1, weak: null });
  });

  it("weak when only one transaction backs it (support 2)", () => {
    expect(historyLookup("zonnebloem de hoek", [entry("zonnebloem de hoek", 1, 1)])).toEqual({
      strong: null,
      weak: 1,
    });
  });

  it("weak when the close shops disagree (agreement 80%)", () => {
    const h = [entry("zonnebloem de hoek", 1, 3), entry("zonnebloem de hoek", 2, 2)];
    expect(historyLookup("zonnebloem de hoek", h)).toEqual({ strong: null, weak: 1 });
    expect(
      historyLookup("zonnebloem de hoek", [
        entry("zonnebloem de hoek", 1, 4),
        entry("zonnebloem de hoek", 2, 1),
      ]).strong,
    ).toBe(1);
  });

  it("weak when the best shop is related but not close (0.6 to 0.85)", () => {
    const r = historyLookup("albert heijn zoetermeer", [entry("albert heijn delft", 1, 5)]);
    expect(r.strong).toBeNull();
    expect(r.weak).toBe(1);
  });

  it("nothing for an unrelated shop or an empty key, and only categories that fit", () => {
    expect(historyLookup("jumbo", [entry("lidl", 1, 5)])).toEqual({ strong: null, weak: null });
    expect(historyLookup("", [entry("lidl", 1, 5)])).toEqual({ strong: null, weak: null });
    expect(historyLookup("lidl", [entry("lidl", 1, 5)], () => false)).toEqual({
      strong: null,
      weak: null,
    });
  });
});

describe("decide", () => {
  const none = { strong: null, weak: null };
  it("combines the layers", () => {
    expect(decide({ catalog: 1, history: none })).toEqual({
      kind: "apply",
      categoryId: 1,
      source: "catalog",
    });
    expect(decide({ catalog: null, history: { strong: 2, weak: null } })).toEqual({
      kind: "apply",
      categoryId: 2,
      source: "history",
    });
    expect(decide({ catalog: 1, history: { strong: 1, weak: null } })).toMatchObject({
      kind: "apply",
      source: "catalog",
    });
    // The person's habits beat the general list: ask, with their category preselected.
    expect(decide({ catalog: 1, history: { strong: 2, weak: null } })).toEqual({
      kind: "suggest",
      categoryId: 2,
    });
    expect(decide({ catalog: null, history: { strong: null, weak: 3 } })).toEqual({
      kind: "suggest",
      categoryId: 3,
    });
    // A weak history answer never overrides the catalog.
    expect(decide({ catalog: 1, history: { strong: null, weak: 3 } })).toMatchObject({
      kind: "apply",
      categoryId: 1,
    });
    expect(decide({ catalog: null, history: none })).toEqual({ kind: "none" });
  });
});

describe("applyAutomatic with history", () => {
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

  it("a shop the person categorised before is recognised, a similar one is only suggested", async () => {
    const { db, tx, get, cat } = await setup();
    const goingOut = await cat("going-out");
    const own = { categoryId: goingOut, categorySource: "user" as const };
    await tx("Zonnebloem De Hoek", { ...own, merchantKey: "zonnebloem de hoek" });
    await tx("Zonnebloem De Hoek", { ...own, merchantKey: "zonnebloem de hoek" });
    const same = await tx("Zonnebloem De Hoek 1234 Utrecht");
    const similar = await tx("Zonnebloem De Horst");
    const other = await tx("Bakker Piet");
    const result = await applyAutomatic(db);
    expect(await get(same.id)).toMatchObject({ categoryId: goingOut, categorySource: "history" });
    expect(await get(similar.id)).toMatchObject({
      categoryId: null,
      suggestedCategoryId: goingOut,
    });
    expect((await get(other.id)).suggestedCategoryId).toBeNull();
    expect(result).toEqual({ applied: 1, suggested: 1 });
  });

  it("only the person's own decisions count as evidence, never an earlier automatic guess", async () => {
    const { db, tx, get, cat } = await setup();
    const goingOut = await cat("going-out");
    const guess = { categoryId: goingOut, categorySource: "model" as const };
    await tx("Zonnebloem De Hoek", { ...guess, merchantKey: "zonnebloem de hoek" });
    await tx("Zonnebloem De Hoek", { ...guess, merchantKey: "zonnebloem de hoek" });
    const next = await tx("Zonnebloem De Hoek");
    await applyAutomatic(db);
    expect(await get(next.id)).toMatchObject({ categoryId: null, suggestedCategoryId: null });
  });

  it("the catalog and the person's habit disagree: ask, with the habit preselected", async () => {
    const { db, tx, get, cat } = await setup();
    const sport = await cat("sport");
    const own = { categoryId: sport, categorySource: "user" as const };
    // They always file their groceries shop under sport (say, a sports nutrition shop called Lidl Sport).
    await tx("Lidl Sport", { ...own, merchantKey: "lidl sport" });
    await tx("Lidl Sport", { ...own, merchantKey: "lidl sport" });
    const next = await tx("Lidl Sport");
    await applyAutomatic(db);
    expect(await get(next.id)).toMatchObject({ categoryId: null, suggestedCategoryId: sport });
  });

  it("never offers a category of the wrong direction", async () => {
    const { db, tx, get, cat } = await setup();
    const salary = await cat("salary"); // an income category
    await tx("Kantoor Piet", {
      categoryId: salary,
      categorySource: "user",
      merchantKey: "kantoor piet",
    });
    await tx("Kantoor Piet", {
      categoryId: salary,
      categorySource: "user",
      merchantKey: "kantoor piet",
    });
    const out = await tx("Kantoor Piet"); // money out
    await applyAutomatic(db);
    expect((await get(out.id)).categoryId).toBeNull();
  });
});
