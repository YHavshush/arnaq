import { and, desc, eq, gte, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getMonthOverview } from "@/lib/budget/overview";
import { addMonths } from "@/lib/recurring/dates";

export interface CategoryDetailRow {
  id: number;
  date: string;
  /** Signed cents, as in the bank. */
  amount: number;
  counterparty: string | null;
  description: string | null;
  source: string | null;
  suggestedCategoryId: number | null;
}

export interface CategoryDetail {
  category: { id: number; name: string; type: "expense" | "income" | "transfer" | "savings" };
  month: string;
  prev: string;
  next: string;
  rows: CategoryDetailRow[];
  /** What the category came to in the month, positive cents, in the direction of its type (spent, received, saved). */
  total: number;
  count: number;
  budget: number | null;
  /** How far over the budget (cents), 0 when not over or without a budget. */
  over: number;
  /** For the sheet that moves a transaction to another category. */
  categories: { id: number; name: string; type: string }[];
  special: { id: number; name: string; type: string }[];
}

/**
 * Every transaction behind one category and month, newest first: what a bank app shows when you tap a category, so
 * a number can be checked and a wrong sort fixed where it is found. Rows in another currency than their account
 * are left out, as they are in every total.
 */
export async function loadCategoryDetail(
  db: Db,
  categoryId: number,
  month: string,
): Promise<CategoryDetail | null> {
  const categories = await db.select().from(schema.categories).orderBy(schema.categories.sortOrder);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return null;
  const t = schema.transactions;
  const rows = await db
    .select({
      id: t.id,
      date: t.date,
      amount: t.amount,
      counterparty: t.counterparty,
      description: t.description,
      source: t.categorySource,
      suggestedCategoryId: t.suggestedCategoryId,
    })
    .from(t)
    .innerJoin(schema.accounts, eq(schema.accounts.id, t.accountId))
    .where(
      and(
        eq(t.categoryId, categoryId),
        eq(t.currency, schema.accounts.currency),
        gte(t.date, `${month}-01`),
        lte(t.date, `${month}-31`),
      ),
    )
    .orderBy(desc(t.date), desc(t.id));

  // Spent for an expense category, received for income, saved (moved out of the account) for savings and transfers.
  const sign = category.type === "income" ? 1 : -1;
  const total = rows.reduce((s, r) => s + sign * r.amount, 0);
  const overview = await getMonthOverview(db, month);
  const line = [...overview.expenses, ...overview.income].find((l) => l.categoryId === categoryId);
  const budget = line?.budget ?? null;
  return {
    category: { id: category.id, name: category.name, type: category.type },
    month,
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
    rows,
    total,
    count: rows.length,
    budget,
    over: budget !== null && category.type === "expense" ? Math.max(total - budget, 0) : 0,
    categories: categories
      .filter((c) => c.type === "expense" || c.type === "income")
      .map((c) => ({ id: c.id, name: c.name, type: c.type })),
    special: categories
      .filter((c) => c.type === "transfer" || c.type === "savings")
      .map((c) => ({ id: c.id, name: c.name, type: c.type })),
  };
}
