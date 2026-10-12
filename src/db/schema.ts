import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Conventions:
// - Money is integer cents, never floats. Stored as bigint, read back as a JS number (safe: MAX_CENTS is far below 2^53).
// - Every table has row level security enabled with no policies (deny all). Supabase exposes the
//   public schema over its REST API; the app itself connects with a role that bypasses RLS.
// - Dates are ISO strings: "YYYY-MM-DD" for days, "YYYY-MM" for months.

export const BANKS = ["rabobank", "revolut"] as const;
export const CATEGORY_TYPES = ["expense", "income", "transfer"] as const;
export const RECURRING_TYPES = ["expense", "income"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export const OCCURRENCE_STATUSES = ["expected", "matched", "missed"] as const;

/** Money column: integer cents as bigint, surfaced as number. */
const cents = (name: string) => bigint(name, { mode: "number" });

export const accounts = pgTable("accounts", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  bank: text("bank", { enum: BANKS }).notNull(),
  iban: text("iban"), // IBAN or other identifier (Revolut)
  currency: text("currency").notNull().default("EUR"),
}).enableRLS();

export const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull().unique(),
  type: text("type", { enum: CATEGORY_TYPES }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}).enableRLS();

export const imports = pgTable("imports", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id),
  month: text("month").notNull(), // YYYY-MM
  filename: text("filename").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsDuplicate: integer("rows_duplicate").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
}).enableRLS();

export const recurringItems = pgTable("recurring_items", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  type: text("type", { enum: RECURRING_TYPES }).notNull(),
  matchCounterparty: text("match_counterparty"),
  matchIban: text("match_iban"),
  expectedAmount: cents("expected_amount").notNull(), // cents, positive
  tolerance: cents("tolerance").notNull().default(0), // cents
  dayOfMonth: integer("day_of_month").notNull(),
  frequency: text("frequency", { enum: FREQUENCIES }).notNull().default("monthly"),
  categoryId: integer("category_id").references(() => categories.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  active: boolean("active").notNull().default(true),
}).enableRLS();

export const recurringOccurrences = pgTable(
  "recurring_occurrences",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    recurringItemId: integer("recurring_item_id")
      .notNull()
      .references(() => recurringItems.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    expectedDate: text("expected_date").notNull(),
    expectedAmount: cents("expected_amount").notNull(), // cents
    status: text("status", { enum: OCCURRENCE_STATUSES }).notNull().default("expected"),
    transactionId: integer("transaction_id").references((): AnyPgColumn => transactions.id),
  },
  (t) => [
    uniqueIndex("occurrence_item_month_idx").on(t.recurringItemId, t.month),
    index("occurrence_status_idx").on(t.status),
  ],
).enableRLS();

/** Suggestions the user said no to, so detection never offers them again. */
export const recurringSuggestionRejections = pgTable(
  "recurring_suggestion_rejections",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    key: text("key").notNull(), // normalised counterparty
    type: text("type", { enum: RECURRING_TYPES }).notNull(),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("suggestion_rejection_key_type_idx").on(t.key, t.type)],
).enableRLS();

export const transactions = pgTable(
  "transactions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    importId: integer("import_id").references(() => imports.id),
    date: text("date").notNull(), // YYYY-MM-DD
    amount: cents("amount").notNull(), // cents, negative = outgoing
    currency: text("currency").notNull().default("EUR"),
    counterparty: text("counterparty"),
    counterpartyIban: text("counterparty_iban"),
    description: text("description"),
    categoryId: integer("category_id").references(() => categories.id),
    importHash: text("import_hash").notNull(),
    matchedOccurrenceId: integer("matched_occurrence_id").references(
      (): AnyPgColumn => recurringOccurrences.id,
    ),
    isInternalTransfer: boolean("is_internal_transfer").notNull().default(false),
  },
  (t) => [
    uniqueIndex("transactions_import_hash_idx").on(t.importHash),
    index("transactions_date_idx").on(t.date),
  ],
).enableRLS();

export const budgets = pgTable(
  "budgets",
  {
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    amount: cents("amount").notNull(), // cents
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.month] })],
).enableRLS();

export const monthlyTotalBudget = pgTable("monthly_total_budget", {
  month: text("month").primaryKey(), // YYYY-MM
  amount: cents("amount").notNull(), // cents
}).enableRLS();

export const categorisationRules = pgTable("categorisation_rules", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  pattern: text("pattern").notNull(), // matched against counterparty/description
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(0),
}).enableRLS();
