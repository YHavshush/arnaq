import { count } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "./defaults";

/** Insert the default categories and starter rules. Safe to call repeatedly. */
export function seedDefaults(db: Db): void {
  DEFAULT_CATEGORIES.forEach((c, i) => {
    db.insert(schema.categories)
      .values({ name: c.name, type: c.type, sortOrder: i })
      .onConflictDoNothing({ target: schema.categories.name })
      .run();
  });

  // Starter rules only when the user has none, so deleting a rule sticks.
  const [{ n }] = db.select({ n: count() }).from(schema.categorisationRules).all();
  if (n > 0) return;
  const byName = new Map(
    db
      .select()
      .from(schema.categories)
      .all()
      .map((c) => [c.name, c.id]),
  );
  for (const r of DEFAULT_RULES) {
    const categoryId = byName.get(r.category);
    if (categoryId) {
      db.insert(schema.categorisationRules)
        .values({ pattern: r.pattern, categoryId, priority: r.priority })
        .run();
    }
  }
}
