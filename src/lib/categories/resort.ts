import { count, isNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { applyRules } from "@/lib/categories/categorise";
import { applyAutomatic } from "@/lib/smart/auto";
import { applyLearned } from "@/lib/smart/learned";

/**
 * Sort the open transactions again with what arnaq knows now (taught shops, rules, the built-in list), without a new
 * upload. Returns how many it sorted. Rows already sorted, and rows the person undid, are not touched.
 */
export async function resortOpen(db: Db): Promise<{ sorted: number; open: number }> {
  const openCount = async () => {
    const [row] = await db
      .select({ n: count() })
      .from(schema.transactions)
      .where(isNull(schema.transactions.categoryId));
    return row?.n ?? 0;
  };
  const before = await openCount();
  await applyLearned(db);
  await applyRules(db);
  await applyAutomatic(db);
  const open = await openCount();
  return { sorted: Math.max(before - open, 0), open };
}
