// Server-side data loading for the screens. Read-only: nothing here writes.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { getDailySpend, getMonthOverview, getOtherIncome } from "@/lib/budget/overview";
import { getNeedsReview } from "@/lib/categories/categorise";
import { listTransfers } from "@/lib/categories/transfers";
import { getSavingsSummary } from "@/lib/savings/summary";
import { getForecast } from "@/lib/forecast/forecast";
import { addMonths } from "@/lib/recurring/dates";
import { getAutomatic } from "@/lib/smart/review";
import { listRecurringItems } from "@/lib/recurring/items";
import { getMissedOccurrences, getOccurrences } from "@/lib/recurring/occurrences";
import { listLinkableTransactions } from "@/lib/recurring/linkable";
import { detectSuggestions } from "@/lib/recurring/suggestions";
import type { Locale } from "@/i18n/config";
import { getAccountBalances, getOpeningBalance } from "@/lib/forecast/balance";
import { getBtwSummary } from "@/lib/btw/summary";
import { getSavingsSettings } from "@/lib/savings/settings";
import { savingsCategoryIds } from "@/lib/recurring/matching";
import { buildOverzicht } from "./overzicht";
import { buildPrognose } from "./prognose";
import { buildFixedFlow } from "./fixed-flow";
import { buildFixedList } from "./fixed-list";
import { splitRing } from "./fixed-ring";
import { buildFixedTracker, historyMonths, trackerMonths } from "./fixed-tracker";
import { buildVasteLasten } from "./vaste-lasten";

/** A valid YYYY-MM from user input, or the fallback. */
export function parseMonth(raw: string | string[] | undefined, fallback: string): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return typeof s === "string" && /^20\d\d-(0[1-9]|1[0-2])$/.test(s) ? s : fallback;
}

export const HORIZONS = [3, 6, 12, 24] as const;

/** What the coming months are based on, from the address; anything unknown is the averages. */
export function parseBasis(raw: string | string[] | undefined): "averages" | "budget" {
  return (Array.isArray(raw) ? raw[0] : raw) === "budget" ? "budget" : "averages";
}

export function parseHorizon(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (HORIZONS as readonly number[]).includes(n) ? n : 6;
}

export async function loadOverzicht(db: Db, month: string, today: string, locale: Locale) {
  const [overview, allOccurrences, daily, otherIncome, savings, savingsIds, accountsBalance] =
    await Promise.all([
      getMonthOverview(db, month),
      getOccurrences(db, { from: month, to: month }),
      getDailySpend(db, month),
      getOtherIncome(db, month),
      getSavingsSummary(db, { today, month }),
      savingsCategoryIds(db),
      // The balance after the newest transaction: what the opening balance of next month is.
      getOpeningBalance(db, addMonths(today.slice(0, 7), 1)),
    ]);
  // A fixed deposit into savings (e.g. a BTW reserve) is money set aside, not a fixed cost or spending.
  const occurrences = allOccurrences.filter(
    (o) => o.categoryId === null || !savingsIds.has(o.categoryId),
  );
  return {
    ...buildOverzicht({
      overview,
      occurrences,
      today,
      locale,
      daily,
      otherIncome,
      savings,
      accountsBalance,
    }),
    prev: addMonths(month, -1),
    next: addMonths(month, 1),
  };
}

export async function loadPrognose(
  db: Db,
  today: string,
  months: number,
  locale: Locale,
  basis: "averages" | "budget" = "averages",
) {
  // One past month for context keeps the chart to 8 points at the default horizon, so every value
  // can be printed on it (see PrognoseChart).
  return buildPrognose(await getForecast(db, { today, months, pastMonths: 1, basis }), locale);
}

export async function loadVasteLasten(db: Db, month: string, today: string, locale: Locale) {
  // One query for the whole range (the history under each item and the tracker); the month's own rows are cut out of it.
  const months = trackerMonths(month);
  const history = historyMonths(month);
  const [ranged, items, missed, suggestions, categories, linkable, opening] = await Promise.all([
    getOccurrences(db, {
      from: history[0] < months[0] ? history[0] : months[0],
      to: months[months.length - 1],
    }),
    listRecurringItems(db),
    getMissedOccurrences(db),
    detectSuggestions(db, { today }),
    db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
    listLinkableTransactions(db, { today }),
    // The checking balance at the start of the month; savings are not in it (they are not an account with balances).
    getOpeningBalance(db, month),
  ]);
  const occurrences = ranged.filter((o) => o.month === month);
  const base = buildVasteLasten(occurrences, locale);
  const list = buildFixedList({
    rows: [...base.expenses, ...base.income],
    items,
    history: buildFixedTracker({ items, occurrences: ranged, months: history, today }),
    missed,
    month,
  });
  // The ring is the month's income, split by fixed expense (what was paid is the real amount).
  const ring = splitRing(
    base.expenses.map((r) => ({
      id: r.itemId,
      name: r.name,
      amount: r.amount,
      paid: r.status === "matched",
    })),
    list.income.total,
  );
  // The day-by-day balance only makes sense for the months up to now: a later month has no balance to start from.
  const flow =
    month <= today.slice(0, 7)
      ? buildFixedFlow({ month, opening, rows: [...base.expenses, ...base.income] })
      : null;
  return {
    ...base,
    list,
    ring,
    flow: flow && flow.events.length > 0 ? flow : null,
    tracker: buildFixedTracker({ items, occurrences: ranged, months, today }),
    items,
    missed,
    suggestionsCosts: suggestions.filter((s) => s.type === "expense"),
    suggestionsIncome: suggestions.filter((s) => s.type === "income"),
    categories,
    linkable,
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

/** What net worth is made of: the balance of each account, the savings and how they add up. */
export async function loadNetWorth(db: Db, today: string) {
  const [accounts, savings, settings, btw] = await Promise.all([
    getAccountBalances(db),
    getSavingsSummary(db, { today }),
    getSavingsSettings(db),
    getBtwSummary(db, { today }),
  ]);
  const accountsTotal = accounts.reduce((s, a) => s + a.balance, 0);
  const base = settings.anchor ?? settings.start;
  return {
    accounts,
    accountsTotal,
    savings: {
      saved: savings.saved,
      /** The balance a statement reported (or what was typed as already saved) and the day it is for. */
      base,
      baseDate: settings.anchorDate,
      fromStatement: settings.anchor !== null,
      /** Moves into and out of savings since then, net: a deposit adds, a withdrawal subtracts. */
      since: savings.saved - base,
      moves: savings.lines,
    },
    /** Money in the BTW pocket: owed to the tax office, so it is not part of the total. */
    btwPocket: btw.pocket > 0 ? btw.pocket : 0,
    total: accountsTotal + savings.saved,
    hasAny: accounts.length > 0 || savings.anchored || savings.lines > 0 || savings.saved > 0,
  };
}
