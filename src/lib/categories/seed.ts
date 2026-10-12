import { count } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "./defaults";

/** Insert the default categories and starter rules. Safe to call repeatedly. */
export async function seedDefaults(db: Db): Promise<void> {
  await db
    .insert(schema.categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ name: c.name, type: c.type, sortOrder: i })))
    .onConflictDoNothing({ target: schema.categories.name });

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
