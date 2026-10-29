import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { catalogLookup } from "@/lib/smart/catalog-nl";
import { importStatement } from "./service";

const statement = () =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/revolut-statement-sample.csv"), "utf8");

async function rows(db: Awaited<ReturnType<typeof createDb>>) {
  return await db
    .select({
      description: schema.transactions.description,
      amount: schema.transactions.amount,
      internal: schema.transactions.isInternalTransfer,
      category: schema.categories.name,
      source: schema.transactions.categorySource,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId));
}
const find = (list: Awaited<ReturnType<typeof rows>>, text: string) =>
  list.filter((r) => (r.description ?? "").includes(text));

describe("what the bank itself says a row is (Revolut's Category column)", () => {
  it("a top-up is money moving between one's own accounts, not income", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "s.csv" });
    const [topUp] = find(await rows(db), "top-up");
    expect(topUp).toMatchObject({
      internal: true,
      category: "Interne overboeking",
      amount: 150000,
    });
  });
  it("a refund from a shop the list knows goes back to that shop's category", async () => {
    const db = await createDb(":memory:");
    const known = statement().replaceAll("Voorbeeld Webshop", "Spotify");
    await importStatement(db, { content: known, filename: "s.csv" });
    const refunds = find(await rows(db), "Spotify");
    expect(refunds).toHaveLength(2);
    expect(refunds.every((r) => r.category === "Abonnementen" && r.amount > 0)).toBe(true);
  });
  it("a refund from an unknown shop stays open for the person", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "s.csv" });
    expect(find(await rows(db), "Voorbeeld Webshop").every((r) => r.category === null)).toBe(true);
  });
  it("a cash withdrawal is sorted without anyone having to", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "s.csv" });
    expect(find(await rows(db), "Cash withdrawal")[0]).toMatchObject({ category: "Overig" });
  });
});

describe("every open row is sorted on every upload", () => {
  it("a rule added later sorts what an earlier upload left open, on the next upload", async () => {
    const db = await createDb(":memory:");
    await importStatement(db, { content: statement(), filename: "s.csv" });
    expect(find(await rows(db), "Voorbeeld Cinema")[0].category).toBeNull();
    const cat = (await one(
      db.select().from(schema.categories).where(eq(schema.categories.slug, "going-out")),
    ))!;
    await db
      .insert(schema.categorisationRules)
      .values({ pattern: "voorbeeld cinema", categoryId: cat.id, priority: 10 });
    const again = await importStatement(db, { content: statement(), filename: "again.csv" });
    expect(again.rowsImported).toBe(0); // nothing new...
    expect(find(await rows(db), "Voorbeeld Cinema")[0].category).toBe("Uitgaan & social"); // ...but it is sorted now
  });
});

describe("the built-in list knows common words, not only names", () => {
  it.each([
    ["Il Caffe", null], // a café is only ever suggested, see catalogSuggestion
    ["Nori Bali Canggu Restaura", "eating-out"],
    ["Bar LUX", "going-out"],
    ["Poolcafé De Keu", null],
    ["Bck Pb Kappers", "clothing-care"],
    ["Metal plan fee", "subscriptions"],
    ["Gett", "transport"],
    ["Cash withdrawal at Hsbc Indonesia", "other"],
    ["To Belastingdienst", "taxes"],
    ["To EUR BTW", "savings"],
    ["From EUR BTW", "savings"],
    ["From Instant Access Savings", "savings"],
  ])("%s", (name, slug) => {
    expect(catalogLookup(name, null)).toBe(slug);
  });
});
