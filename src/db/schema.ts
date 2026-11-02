import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
/** "transfer": a move between the person's own accounts. "savings": money into or out of savings. Neither is income or spending. */
export const CATEGORY_TYPES = ["expense", "income", "transfer", "savings"] as const;
export const RECURRING_TYPES = ["expense", "income"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export const OCCURRENCE_STATUSES = ["expected", "matched", "missed"] as const;
/**
 * Where a transaction's category came from. `user` is a person's own choice; `learned`, `rule` and
 * `recurring` apply something the person set up; `catalog`, `history` and `model` are automatic (shown
 * as such, one click to undo); `confirmed` is an automatic one the person approved; `undone` is an
 * automatic one the person rejected (automation leaves it alone).
 */
export const CATEGORY_SOURCES = [
  "user",
  "learned",
  "rule",
  "recurring",
  "catalog",
  "history",
  "model",
  "confirmed",
  "undone",
] as const;
export const AUTOMATIC_SOURCES = ["catalog", "history", "model"] as const;
export const LABEL_SOURCES = ["user", "model"] as const;
export const SMART_PROVIDERS = ["off", "claude", "chatgpt"] as const;

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
    /** Stable key of a default category (survives renaming); null for the user's own categories. */
    slug: text("slug"),
  },
  (t) => [
    unique("categories_user_id_id_unique").on(t.userId, t.id),
    unique("categories_user_name_unique").on(t.userId, t.name),
    uniqueIndex("categories_user_slug_idx")
      .on(t.userId, t.slug)
      .where(sql`${t.slug} is not null`),
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
    /** Where `categoryId` came from (see CATEGORY_SOURCES); null while uncategorised or before this existed. */
    categorySource: text("category_source", { enum: CATEGORY_SOURCES }),
    /** A category worth offering ("Probably X?") that was not sure enough to apply. */
    suggestedCategoryId: integer("suggested_category_id"),
    /** Normalised counterparty, the key for learned labels and the history layer. Filled lazily. */
    merchantKey: text("merchant_key"),
    /** The account balance after this transaction as the bank states it (cents); null when unknown. */
    balanceAfter: cents("balance_after"),
  },
  (t): PgTableExtraConfigValue[] => [
    unique("transactions_user_id_id_unique").on(t.userId, t.id),
    index("transactions_merchant_key_idx").on(t.userId, t.merchantKey),
    check(
      "transactions_category_source_check",
      sql`${t.categorySource} is null or ${t.categorySource} in ('user','learned','rule','recurring','catalog','history','model','confirmed','undone')`,
    ),
    foreignKey({
      name: "transactions_suggested_category_fk",
      columns: [t.userId, t.suggestedCategoryId],
      foreignColumns: [categories.userId, categories.id],
    }),
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

/**
 * What is known about a shop (by merchant key) for one user: their own choice (`user`) or what the
 * language model said (`model`; null category = it abstained). One table for learned labels and the
 * model cache. A `user` row is never overwritten by the model. Per user on purpose: a shared cache
 * would break the tenancy invariant and reveal what other people pay.
 */
export const merchantLabels = pgTable(
  "merchant_labels",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    merchantKey: text("merchant_key").notNull(),
    categoryId: integer("category_id"),
    source: text("source", { enum: LABEL_SOURCES }).notNull(),
    provider: text("provider"),
    /** Hash of the user's category set when the model abstained, so it is asked again when that changes. */
    optionsHash: text("options_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_labels_user_key_idx").on(t.userId, t.merchantKey),
    check("merchant_labels_source_check", sql`${t.source} in ('user','model')`),
    foreignKey({
      name: "merchant_labels_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("cascade"),
  ],
).enableRLS();

/** One row per user at most; no row means the defaults (smart sorting off). */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .notNull()
      .default(sql`app.uid()`)
      .references(() => appUsers.userId, { onDelete: "cascade" }),
    smartProvider: text("smart_provider", { enum: SMART_PROVIDERS }).notNull().default("off"),
    /** Version of the consent text the user agreed to; null = never. */
    consentVersion: integer("consent_version"),
    consentAt: timestamp("consent_at", { withTimezone: true, mode: "string" }),
    /** A smart run holds this lease so two runs for one user cannot overlap. */
    smartLeaseUntil: timestamp("smart_lease_until", { withTimezone: true, mode: "string" }),
    /** Version of the default categories and rules this user has been upgraded to. */
    defaultsVersion: integer("defaults_version").notNull().default(1),
    /** The total the person wants to have saved (cents); null = no goal. */
    savingsGoal: cents("savings_goal"),
    /** What they had saved before their first upload (cents): progress starts here. */
    savingsStart: cents("savings_start").notNull().default(0),
    /** The savings balance a statement reported (cents) and the day it is for (YYYY-MM-DD): the total counts on from here. */
    savingsAnchor: cents("savings_anchor"),
    savingsAnchorDate: text("savings_anchor_date"),
    /** Who pays the invoices the BTW is set aside for, and the word that marks the pocket's moves; null = the default. */
    btwClient: text("btw_client"),
    btwPocket: text("btw_pocket"),
    /** What the person expects to spend each month on everyday things (cents); the "my own" basis of the forecast. */
    forecastOwnSpending: cents("forecast_own_spending"),
  },
  () => [
    check("user_settings_provider_check", sql`smart_provider in ('off','claude','chatgpt')`),
    check(
      "user_settings_savings_check",
      sql`(savings_goal is null or savings_goal > 0) and savings_start >= 0`,
    ),
    check(
      "user_settings_savings_anchor_check",
      sql`(savings_anchor is null) = (savings_anchor_date is null) and (savings_anchor is null or savings_anchor >= 0)`,
    ),
    check(
      "user_settings_own_spending_check",
      sql`forecast_own_spending is null or forecast_own_spending >= 0`,
    ),
    check(
      "user_settings_btw_check",
      sql`(btw_client is null or char_length(btw_client) between 1 and 60) and (btw_pocket is null or char_length(btw_pocket) between 1 and 60)`,
    ),
  ],
).enableRLS();

/**
 * An amount the person typed into the plan grid for one month (cents), over the suggestion: either a category's
 * everyday spending (`categoryId`) or a fixed item's amount (`itemId`, income or expense), never both. The forecast uses
 * it for months still to come only; past months and real money are never overridden. Deleting the category or the item
 * deletes what was typed for it.
 */
export const planOverrides = pgTable(
  "plan_overrides",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: owner(),
    categoryId: integer("category_id"),
    itemId: integer("item_id"),
    month: text("month").notNull(), // YYYY-MM
    amount: cents("amount").notNull(), // cents, >= 0
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Nulls are distinct, so each constraint only binds the rows of its own kind.
    unique("plan_overrides_user_category_month_unique").on(t.userId, t.categoryId, t.month),
    unique("plan_overrides_user_item_month_unique").on(t.userId, t.itemId, t.month),
    check("plan_overrides_target_check", sql`(category_id is null) <> (item_id is null)`),
    check("plan_overrides_amount_check", sql`amount >= 0`),
    check("plan_overrides_month_check", sql`month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    foreignKey({
      name: "plan_overrides_category_fk",
      columns: [t.userId, t.categoryId],
      foreignColumns: [categories.userId, categories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "plan_overrides_item_fk",
      columns: [t.userId, t.itemId],
      foreignColumns: [recurringItems.userId, recurringItems.id],
    }).onDelete("cascade"),
  ],
).enableRLS();

/** What the language model has been asked for, per user per day (caps and cost). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: owner(),
    day: text("day").notNull(), // YYYY-MM-DD
    merchants: integer("merchants").notNull().default(0),
    calls: integer("calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
).enableRLS();
