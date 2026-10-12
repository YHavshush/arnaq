// Server-side data loading for the screens. Read-only: nothing here writes.
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getMonthOverview } from "@/lib/budget/overview";
import { getNeedsReview } from "@/lib/categories/categorise";
import { getForecast } from "@/lib/forecast/forecast";
import { addMonths } from "@/lib/recurring/dates";
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
  const [overview, occurrences] = await Promise.all([
    getMonthOverview(db, month),
    getOccurrences(db, { from: month, to: month }),
  ]);
  return {
    ...buildOverzicht({ overview, occurrences, today, locale }),
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
  };
}

export async function loadPrognose(db: Db, today: string, months: number, locale: Locale) {
  return buildPrognose(await getForecast(db, { today, months }), locale);
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
    suggestions,
    categories,
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
  };
}

export async function loadUpload(db: Db) {
  const [accounts, categories, review, imports, [counts]] = await Promise.all([
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
  ]);
  const left = review.length;
  const total = counts?.total ?? 0;
  return {
    accounts,
    categories: categories.filter((c) => c.type !== "transfer"),
    review: review.slice(0, 50),
    reviewCount: left,
    imports,
    total,
    sorted: Math.max(total - left, 0),
    share: total === 0 ? 0 : Math.max(total - left, 0) / total,
  };
}
