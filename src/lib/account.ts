import { schema, type Db } from "@/db";
import { seedDefaults } from "@/lib/categories/seed";

/**
 * Delete everything this person has stored: transactions, imports, accounts, categories, rules, budgets,
 * fixed costs, learned shops and settings. They keep their login (the sign-in lives in Supabase Auth and
 * is removed there) and start again with fresh default categories. Runs as the current user, so row level
 * security keeps it to their own rows.
 */
export async function deleteAllMyData(db: Db): Promise<void> {
  await wipeMyData(db);
  await seedDefaults(db);
}

/** Remove every row the current person owns (children first), without putting anything back. */
export async function wipeMyData(db: Db): Promise<void> {
  // The matched payment and its occurrence point at each other: cut one side first.
  await db.update(schema.transactions).set({ matchedOccurrenceId: null });
  await db.delete(schema.planOverrides);
  await db.delete(schema.recurringOccurrences);
  await db.delete(schema.transactions);
  await db.delete(schema.recurringItems);
  await db.delete(schema.recurringSuggestionRejections);
  await db.delete(schema.imports);
  await db.delete(schema.budgets);
  await db.delete(schema.monthlyTotalBudget);
  await db.delete(schema.categorisationRules);
  await db.delete(schema.merchantLabels);
  // ai_usage stays: wiping it would reset the daily cap on smart sorting, which is a cost limit, not the person's data.
  await db.delete(schema.userSettings);
  await db.delete(schema.btwClients);
  await db.delete(schema.accounts);
  await db.delete(schema.categories);
}
