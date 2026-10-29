import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { count } from "drizzle-orm";
import { DEFAULT_CATEGORIES, DEFAULT_RULES, SAVINGS_CATEGORY, TAXES_CATEGORY } from "./defaults";

/** Insert the current user's default categories and starter rules. Safe to call repeatedly. */
export async function seedDefaults(db: Db): Promise<void> {
  await db
    .insert(schema.categories)
    .values(
      DEFAULT_CATEGORIES.map((c, i) => ({
        slug: c.slug,
        name: c.name,
        type: c.type,
        sortOrder: i,
      })),
    )
    .onConflictDoNothing({ target: [schema.categories.userId, schema.categories.name] });

  // Starter rules only when the user has none, so deleting a rule sticks.
  const [{ n }] = await db.select({ n: count() }).from(schema.categorisationRules);
  if (n > 0) return;
  const byName = new Map((await db.select().from(schema.categories)).map((c) => [c.name, c.id]));
  for (const r of DEFAULT_RULES) {
    const categoryId = byName.get(r.category);
    if (categoryId) {
      await db
        .insert(schema.categorisationRules)
        .values({ pattern: r.pattern, categoryId, priority: r.priority });
    }
  }
}

/**
 * People who signed up before the Savings category existed do not have it. Adds it when missing
 * (once per category name, so safe to call on every first request).
 */
export async function ensureSavingsCategory(db: Db): Promise<void> {
  const [{ n }] = await db.select({ n: count() }).from(schema.categories);
  await db
    .insert(schema.categories)
    .values({ slug: "savings", name: SAVINGS_CATEGORY, type: "savings", sortOrder: n })
    .onConflictDoNothing({ target: [schema.categories.userId, schema.categories.name] });
}

/** The same for Taxes, added later: people who signed up before it existed get it (and the starter rule) when missing. */
export async function ensureTaxesCategory(db: Db): Promise<void> {
  const [{ n }] = await db.select({ n: count() }).from(schema.categories);
  const [created] = await db
    .insert(schema.categories)
    .values({ slug: "taxes", name: TAXES_CATEGORY, type: "expense", sortOrder: n })
    .onConflictDoNothing({ target: [schema.categories.userId, schema.categories.name] })
    .returning({ id: schema.categories.id });
  if (!created) return;
  const rule = DEFAULT_RULES.find((r) => r.category === TAXES_CATEGORY);
  if (rule)
    await db
      .insert(schema.categorisationRules)
      .values({ pattern: rule.pattern, categoryId: created.id, priority: rule.priority });
}
