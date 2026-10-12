import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";

// Conventions:
// - Money is integer cents, never floats. Stored as bigint, read back as a JS number (safe: MAX_CENTS is far below 2^53).
// - Every table has row level security enabled and a policy that only lets a user see and change their
//   own rows (migration 0003). The app connects as `kasboek_app` (not the owner, no BYPASSRLS) and each
//   request sets `app.user_id` for its transaction; `user_id` is filled by the column default and is
//   never written by app code. Without a user the default raises, so a forgotten wrapper fails closed.
// - Foreign keys are composite (user_id, x_id): a row can never point at another user's row.
// - Dates are ISO strings: "YYYY-MM-DD" for days, "YYYY-MM" for months.

export const BANKS = ["rabobank", "revolut"] as const;
export const CATEGORY_TYPES = ["expense", "income", "transfer"] as const;
export const RECURRING_TYPES = ["expense", "income"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export const OCCURRENCE_STATUSES = ["expected", "matched", "missed"] as const;

/** Money column: integer cents as bigint, surfaced as number. */
const cents = (name: string) => bigint(name, { mode: "number" });

/** Who owns the row. Filled by the database from the request's user; never set by app code. */
const owner = () =>
  uuid("user_id")
    .notNull()
    .default(sql`app.uid()`)
    .references(() => appUsers.userId, { onDelete: "cascade" });

/** One row per person who has data. `seededAt` is when their default categories and rules were created. */
export const appUsers = pgTable("app_users", {
  userId: uuid("user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}).enableRLS();

export const accounts = pgTable(
  "accounts",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    name: text("name").notNull(),
    bank: text("bank", { enum: BANKS }).notNull(),
    iban: text("iban"), // IBAN or other identifier (Revolut)
    currency: text("currency").notNull().default("EUR"),
  },
  (t) => [
    unique("accounts_user_id_id_unique").on(t.userId, t.id),
    uniqueIndex("accounts_user_iban_idx")
      .on(t.userId, t.iban)
      .where(sql`${t.iban} is not null`),
  ],
).enableRLS();

export const categories = pgTable(
  "categories",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    name: text("name").notNull(),
    type: text("type", { enum: CATEGORY_TYPES }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("categories_user_id_id_unique").on(t.userId, t.id),
    unique("categories_user_name_unique").on(t.userId, t.name),
  ],
).enableRLS();

export const imports = pgTable(
  "imports",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    accountId: integer("account_id").notNull(),
    month: text("month").notNull(), // YYYY-MM
    /** The period the file declares (PDF statements, Revolut file names), inclusive. Null: judge by `month`. */
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    filename: text("filename").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsImported: integer("rows_imported").notNull().default(0),
    rowsDuplicate: integer("rows_duplicate").notNull().default(0),
    rowsSkipped: integer("rows_skipped").notNull().default(0),
  },
  (t) => [
    unique("imports_user_id_id_unique").on(t.userId, t.id),
    foreignKey({
      name: "imports_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
  ],
).enableRLS();

export const recurringItems = pgTable(
  "recurring_items",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    name: text("name").notNull(),
    type: text("type", { enum: RECURRING_TYPES }).notNull(),
    matchCounterparty: text("match_counterparty"),
    matchIban: text("match_iban"),
    expectedAmount: cents("expected_amount").notNull(), // cents, positive
    tolerance: cents("tolerance").notNull().default(0), // cents
    dayOfMonth: integer("day_of_month").notNull(),
    frequency: text("frequency", { enum: FREQUENCIES }).notNull().default("monthly"),
    categoryId: integer("category_id"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("recurring_items_user_id_id_unique").on(t.userId, t.id),
    foreignKey({
      name: "recurring_items_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
  ],
).enableRLS();

export const recurringOccurrences = pgTable(
  "recurring_occurrences",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    recurringItemId: integer("recurring_item_id").notNull(),
    month: text("month").notNull(), // YYYY-MM
    expectedDate: text("expected_date").notNull(),
    expectedAmount: cents("expected_amount").notNull(), // cents
    status: text("status", { enum: OCCURRENCE_STATUSES }).notNull().default("expected"),
    transactionId: integer("transaction_id"),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("recurring_occurrences_user_id_id_unique").on(t.userId, t.id),
    uniqueIndex("occurrence_item_month_idx").on(t.recurringItemId, t.month),
    index("occurrence_status_idx").on(t.status),
    foreignKey({
      name: "occurrences_item_fk",
      columns: [t.userId, t.recurringItemId],
      foreignColumns: [recurringItems.userId, recurringItems.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "occurrences_transaction_fk",
      columns: [t.userId, t.transactionId],
      foreignColumns: [transactions.userId, transactions.id],
    }),
  ],
).enableRLS();

/** Suggestions the user said no to, so detection never offers them again. */
export const recurringSuggestionRejections = pgTable(
  "recurring_suggestion_rejections",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    key: text("key").notNull(), // normalised counterparty
    type: text("type", { enum: RECURRING_TYPES }).notNull(),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("suggestion_rejection_key_type_idx").on(t.userId, t.key, t.type)],
).enableRLS();

export const transactions = pgTable(
  "transactions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    accountId: integer("account_id").notNull(),
    importId: integer("import_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    amount: cents("amount").notNull(), // cents, negative = outgoing
    currency: text("currency").notNull().default("EUR"),
    counterparty: text("counterparty"),
    counterpartyIban: text("counterparty_iban"),
    description: text("description"),
    categoryId: integer("category_id"),
    importHash: text("import_hash").notNull(),
    matchedOccurrenceId: integer("matched_occurrence_id"),
    isInternalTransfer: boolean("is_internal_transfer").notNull().default(false),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("transactions_user_id_id_unique").on(t.userId, t.id),
    uniqueIndex("transactions_import_hash_idx").on(t.userId, t.importHash),
    index("transactions_date_idx").on(t.userId, t.date),
    foreignKey({
      name: "transactions_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "transactions_import_fk",
      columns: [t.userId, t.importId],
      foreignColumns: [imports.userId, imports.id],
    }),
    foreignKey({
      name: "transactions_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
    foreignKey({
      name: "transactions_matched_occurrence_fk",
      columns: [t.userId, t.matchedOccurrenceId],
      foreignColumns: [recurringOccurrences.userId, recurringOccurrences.id],
    }),
  ],
).enableRLS();

export const budgets = pgTable(
  "budgets",
  {
    userId: owner(),
    categoryId: integer("category_id").notNull(),
    month: text("month").notNull(), // YYYY-MM
    amount: cents("amount").notNull(), // cents
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.categoryId, t.month] }),
    foreignKey({
      name: "budgets_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("cascade"),
  ],
).enableRLS();

export const monthlyTotalBudget = pgTable(
  "monthly_total_budget",
  {
    userId: owner(),
    month: text("month").notNull(), // YYYY-MM
    amount: cents("amount").notNull(), // cents
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] })],
).enableRLS();

export const categorisationRules = pgTable(
  "categorisation_rules",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    pattern: text("pattern").notNull(), // matched against counterparty/description
    categoryId: integer("category_id").notNull(),
    priority: integer("priority").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "rules_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("cascade"),
  ],
).enableRLS();
