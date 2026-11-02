import { asc, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";

/** Bump when the shape of the export changes, so a future restore knows what it is reading. */
export const EXPORT_VERSION = 8; // 2: category slugs and sources, merchantLabels, userSettings; 3: transactions.balanceAfter; 4: userSettings.savingsGoal and savingsStart, category type "savings"; 5: userSettings.savingsAnchor and savingsAnchorDate; 6: userSettings.btwClient and btwPocket; 7: userSettings.forecastOwnSpending; 8: planOverrides

const TABLES = {
  accounts: schema.accounts,
  categories: schema.categories,
  categorisationRules: schema.categorisationRules,
  imports: schema.imports,
  transactions: schema.transactions,
  recurringItems: schema.recurringItems,
  recurringOccurrences: schema.recurringOccurrences,
  recurringSuggestionRejections: schema.recurringSuggestionRejections,
  budgets: schema.budgets,
  monthlyTotalBudget: schema.monthlyTotalBudget,
  merchantLabels: schema.merchantLabels,
  userSettings: schema.userSettings,
  planOverrides: schema.planOverrides,
  // ai_usage is bookkeeping for the caps, not the person's data: it stays out.
} as const;

export interface FullExport {
  app: "arnaq";
  version: number;
  exportedAt: string;
  /** Every table, rows as stored (money in integer cents, dates as text). */
  tables: { [K in keyof typeof TABLES]: Record<string, unknown>[] };
}

/** Everything the app stores, as plain JSON: the backup. Read-only. */
export async function buildExport(db: Db, now: Date = new Date()): Promise<FullExport> {
  const tables = {} as FullExport["tables"];
  for (const [name, table] of Object.entries(TABLES)) {
    // Rows belong to one person; the owner id is not part of the backup (it is the same on every row
    // and would not mean anything in another account).
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    (tables as Record<string, unknown[]>)[name] = rows.map(({ userId, ...rest }) => {
      void userId;
      return rest;
    });
  }
  return { app: "arnaq", version: EXPORT_VERSION, exportedAt: now.toISOString(), tables };
}

/**
 * A spreadsheet cell from bank text. Text that starts with = + - @ (or a tab or return) would be
 * run as a formula by Excel and friends, and bank descriptions are written by third parties, so
 * those get a leading apostrophe. Quotes and the separator are escaped.
 */
export function csvText(value: string | null): string {
  if (value === null || value === "") return "";
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const euros = (cents: number) =>
  `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`;

/** All transactions as CSV for a spreadsheet: `;` separated, decimal comma, UTF-8 with BOM. */
export async function transactionsCsv(db: Db): Promise<string> {
  const rows = await db
    .select({
      date: schema.transactions.date,
      account: schema.accounts.name,
      amount: schema.transactions.amount,
      currency: schema.transactions.currency,
      counterparty: schema.transactions.counterparty,
      iban: schema.transactions.counterpartyIban,
      description: schema.transactions.description,
      category: schema.categories.name,
      internal: schema.transactions.isInternalTransfer,
    })
    .from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.transactions.accountId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
    .orderBy(desc(schema.transactions.date), asc(schema.transactions.id));
  const lines = [
    "Datum;Rekening;Bedrag;Munt;Naam;Tegenrekening;Omschrijving;Categorie;Interne overboeking",
  ];
  for (const r of rows)
    lines.push(
      [
        r.date,
        csvText(r.account),
        euros(r.amount),
        r.currency,
        csvText(r.counterparty),
        csvText(r.iban),
        csvText(r.description),
        csvText(r.category),
        r.internal ? "ja" : "nee",
      ].join(";"),
    );
  return `﻿${lines.join("\r\n")}\r\n`;
}
