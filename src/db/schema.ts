import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// Conventions:
// - Money is integer cents, never floats.
// - Dates are ISO strings: "YYYY-MM-DD" for days, "YYYY-MM" for months.

export const BANKS = ["rabobank", "revolut"] as const;
export const CATEGORY_TYPES = ["expense", "income", "transfer"] as const;
export const RECURRING_TYPES = ["expense", "income"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export const OCCURRENCE_STATUSES = ["expected", "matched", "missed"] as const;

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  bank: text("bank", { enum: BANKS }).notNull(),
  iban: text("iban"), // IBAN or other identifier (Revolut)
  currency: text("currency").notNull().default("EUR"),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  type: text("type", { enum: CATEGORY_TYPES }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  month: text("month").notNull(), // YYYY-MM
  filename: text("filename").notNull(),
  uploadedAt: text("uploaded_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsDuplicate: integer("rows_duplicate").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
});

export const recurringItems = sqliteTable("recurring_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: RECURRING_TYPES }).notNull(),
  matchCounterparty: text("match_counterparty"),
  matchIban: text("match_iban"),
  expectedAmount: integer("expected_amount").notNull(), // cents, positive
  tolerance: integer("tolerance").notNull().default(0), // cents
  dayOfMonth: integer("day_of_month").notNull(),
  frequency: text("frequency", { enum: FREQUENCIES }).notNull().default("monthly"),
  categoryId: integer("category_id").references(() => categories.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const recurringOccurrences = sqliteTable(
  "recurring_occurrences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recurringItemId: integer("recurring_item_id")
      .notNull()
      .references(() => recurringItems.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    expectedDate: text("expected_date").notNull(),
    expectedAmount: integer("expected_amount").notNull(), // cents
    status: text("status", { enum: OCCURRENCE_STATUSES }).notNull().default("expected"),
    transactionId: integer("transaction_id").references((): AnySQLiteColumn => transactions.id),
  },
  (t) => [uniqueIndex("occurrence_item_month_idx").on(t.recurringItemId, t.month)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    importId: integer("import_id").references(() => imports.id),
    date: text("date").notNull(), // YYYY-MM-DD
    amount: integer("amount").notNull(), // cents, negative = outgoing
    currency: text("currency").notNull().default("EUR"),
    counterparty: text("counterparty"),
    counterpartyIban: text("counterparty_iban"),
    description: text("description"),
    categoryId: integer("category_id").references(() => categories.id),
    importHash: text("import_hash").notNull(),
    matchedOccurrenceId: integer("matched_occurrence_id").references(
      (): AnySQLiteColumn => recurringOccurrences.id,
    ),
    isInternalTransfer: integer("is_internal_transfer", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [
    uniqueIndex("transactions_import_hash_idx").on(t.importHash),
    index("transactions_date_idx").on(t.date),
  ],
);

export const budgets = sqliteTable(
  "budgets",
  {
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    amount: integer("amount").notNull(), // cents
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.month] })],
);

export const monthlyTotalBudget = sqliteTable("monthly_total_budget", {
  month: text("month").primaryKey(), // YYYY-MM
  amount: integer("amount").notNull(), // cents
});

export const categorisationRules = sqliteTable("categorisation_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pattern: text("pattern").notNull(), // matched against counterparty/description
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(0),
});
