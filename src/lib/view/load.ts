// Server-side data loading for the screens. Read-only: nothing here writes.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getDailySpend, getMonthOverview, getOtherIncome } from "@/lib/budget/overview";
import { getNeedsReview } from "@/lib/categories/categorise";
import { listTransfers } from "@/lib/categories/transfers";
import { getForecast } from "@/lib/forecast/forecast";
import { addMonths } from "@/lib/recurring/dates";
import { getAutomatic } from "@/lib/smart/review";
import { listRecurringItems } from "@/lib/recurring/items";
import { getMissedOccurrences, getOccurrences } from "@/lib/recurring/occurrences";
import { detectSuggestions } from "@/lib/recurring/suggestions";
import type { Locale } from "@/i18n/config";
import { buildOverzicht } from "./overzicht";
import { buildPrognose } from "./prognose";
import { buildVasteLasten } from "./vaste-lasten";

/** A valid YYYY-MM from user input, or the fallback. */
export function parseMonth(raw: string | string[] | undefined, fallback: string): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])$/.test(s) ? s : fallback;
}

export const HORIZONS = [3, 6, 12, 24] as const;

export function parseHorizon(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (HORIZONS as readonly number[]).includes(n) ? n : 6;
}

export async function loadOverzicht(db: Db, month: string, today: string, locale: Locale) {
  const [overview, occurrences, daily, otherIncome] = await Promise.all([
    getMonthOverview(db, month),
    getOccurrences(db, { from: month, to: month }),
    getDailySpend(db, month),
    getOtherIncome(db, month),
  ]);
  return {
    ...buildOverzicht({ overview, occurrences, today, locale, daily, otherIncome }),
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
  };
}

export async function loadPrognose(db: Db, today: string, months: number, locale: Locale) {
  // One past month for context keeps the chart to 8 points at the default horizon, so every value
  // can be printed on it (see PrognoseChart).
  return buildPrognose(await getForecast(db, { today, months, pastMonths: 1 }), locale);
}

export async function loadVasteLasten(db: Db, month: string, today: string, locale: Locale) {
  const [occurrences, items, missed, suggestions, categories] = await Promise.all([
    getOccurrences(db, { from: month, to: month }),
    listRecurringItems(db),
    getMissedOccurrences(db),
    detectSuggestions(db, { today }),
    db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
  ]);
  return {
    ...buildVasteLasten(occurrences, locale),
    items,
    missed,
    suggestionsCosts: suggestions.filter((s) => s.type === "expense"),
    suggestionsIncome: suggestions.filter((s) => s.type === "income"),
    categories,
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
  };
}

export async function loadUpload(db: Db) {
  const [accounts, categories, review, imports, [counts], automatic, transfers] = await Promise.all(
    [
      db.select().from(schema.accounts),
      db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
      getNeedsReview(db),
      db
        .select({
          id: schema.imports.id,
          filename: schema.imports.filename,
          month: schema.imports.month,
          periodFrom: schema.imports.periodFrom,
          periodTo: schema.imports.periodTo,
          uploadedAt: schema.imports.uploadedAt,
          rowsImported: schema.imports.rowsImported,
          rowsDuplicate: schema.imports.rowsDuplicate,
          rowsSkipped: schema.imports.rowsSkipped,
          account: schema.accounts.name,
        })
        .from(schema.imports)
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.imports.accountId))
        .orderBy(desc(schema.imports.id))
        .limit(5),
      db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.transactions)
        .where(and(eq(schema.transactions.isInternalTransfer, false))),
      getAutomatic(db),
      listTransfers(db),
    ],
  );
  const left = review.length;
  const total = counts?.total ?? 0;
  const used = new Map(
    (
      await db
        .select({
          id: schema.transactions.categoryId,
          n: sql<number>`count(*)`.mapWith(Number),
        })
        .from(schema.transactions)
        .where(isNotNull(schema.transactions.categoryId))
        .groupBy(schema.transactions.categoryId)
    ).map((r) => [r.id, r.n]),
  );
  // The person's most used categories first (the list is already in display order for ties).
  const usual = (type: "expense" | "income") =>
    categories
      .filter((c) => c.type === type)
      .sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0))
      .slice(0, 3)
      .map((c) => c.id);
  return {
    accounts,
    categories: categories.filter((c) => c.type === "expense" || c.type === "income"),
    // Neither income nor spending: a move between the person's own accounts, and money into or out of savings.
    special: (["transfer", "savings"] as const).flatMap((t) =>
      categories.filter((c) => c.type === t),
    ),
    quick: { expense: usual("expense"), income: usual("income") },
    automatic,
    transfers,
    review: review.slice(0, 50),
    reviewCount: left,
    imports,
    total,
    sorted: Math.max(total - left, 0),
    share: total === 0 ? 0 : Math.max(total - left, 0) / total,
  };
}
