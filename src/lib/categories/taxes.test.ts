import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { catalogLookup } from "@/lib/smart/catalog-nl";
import { TAXES_CATEGORY } from "./defaults";
import { ensureTaxesCategory } from "./seed";

describe("the Taxes category", () => {
  it("is among the default categories, with a starter rule for the tax office", async () => {
    const db = await createDb(":memory:");
    const taxes = await one(
      db.select().from(schema.categories).where(eq(schema.categories.name, TAXES_CATEGORY)),
    );
    expect(taxes).toMatchObject({ slug: "taxes", type: "expense" });
    const rules = await db.select().from(schema.categorisationRules);
    expect(rules.some((r) => r.pattern === "belastingdienst" && r.categoryId === taxes!.id)).toBe(
      true,
    );
  });
  it("is added for an account that was created before it existed, once", async () => {
    const db = await createDb(":memory:");
    await db
      .delete(schema.categorisationRules)
      .where(eq(schema.categorisationRules.pattern, "belastingdienst"));
    await db.delete(schema.categories).where(eq(schema.categories.slug, "taxes"));
    await ensureTaxesCategory(db);
    await ensureTaxesCategory(db);
    const taxes = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.slug, "taxes"));
    expect(taxes).toHaveLength(1);
    const rules = await db
      .select()
      .from(schema.categorisationRules)
      .where(eq(schema.categorisationRules.pattern, "belastingdienst"));
    expect(rules).toHaveLength(1);
  });
  it("is what the built-in list answers for a payment to the tax office", () => {
    expect(catalogLookup("To Belastingdienst", null)).toBe("taxes");
  });
});
