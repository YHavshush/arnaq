-- Multi-user tenancy (docs/plans/auth-tenancy.md).
-- Written by hand in a safe order: owner column first (existing rows go to a sentinel owner nobody can
-- log in as; `npm run db:claim` moves them), then the constraints, then the role, grants and policies.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- The request's user. The app sets app.user_id inside each transaction (set_config(..., true)).
-- Without it this raises, so a query that runs without the wrapper fails closed.
CREATE OR REPLACE FUNCTION app.uid() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.user_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'no tenant' USING ERRCODE = '42501';
  END IF;
  RETURN v::uuid;
END
$$;
--> statement-breakpoint

CREATE TABLE "app_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "app_users" ("user_id") VALUES ('00000000-0000-0000-0000-000000000000');
--> statement-breakpoint

-- Old single-tenant constraints go; the per-user ones are added below.
ALTER TABLE "categories" DROP CONSTRAINT "categories_name_unique";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "categorisation_rules" DROP CONSTRAINT "categorisation_rules_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_items" DROP CONSTRAINT "recurring_items_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" DROP CONSTRAINT "recurring_occurrences_recurring_item_id_recurring_items_id_fk";
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" DROP CONSTRAINT "recurring_occurrences_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_import_id_imports_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_matched_occurrence_id_recurring_occurrences_id_fk";
--> statement-breakpoint
DROP INDEX "suggestion_rejection_key_type_idx";
--> statement-breakpoint
DROP INDEX "transactions_import_hash_idx";
--> statement-breakpoint
DROP INDEX "transactions_date_idx";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_category_id_month_pk";
--> statement-breakpoint
ALTER TABLE "monthly_total_budget" DROP CONSTRAINT "monthly_total_budget_pkey";
--> statement-breakpoint

-- The owner column: add without a default, give existing rows the sentinel, then lock it down.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','budgets','categories','categorisation_rules','imports',
    'monthly_total_budget','recurring_items','recurring_occurrences','recurring_suggestion_rejections','transactions']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN user_id uuid', t);
    EXECUTE format('UPDATE %I SET user_id = %L', t, '00000000-0000-0000-0000-000000000000');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT app.uid()', t);
  END LOOP;
END
$$;
--> statement-breakpoint

ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_category_id_month_pk" PRIMARY KEY("user_id","category_id","month");
--> statement-breakpoint
ALTER TABLE "monthly_total_budget" ADD CONSTRAINT "monthly_total_budget_user_id_month_pk" PRIMARY KEY("user_id","month");
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_id_unique" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_id_unique" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_id_unique" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_user_id_id_unique" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_user_id_id_unique" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_id_unique" UNIQUE("user_id","id");
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categorisation_rules" ADD CONSTRAINT "categorisation_rules_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categorisation_rules" ADD CONSTRAINT "rules_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monthly_total_budget" ADD CONSTRAINT "monthly_total_budget_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "recurring_occurrences_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "occurrences_item_fk" FOREIGN KEY ("user_id","recurring_item_id") REFERENCES "public"."recurring_items"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "occurrences_transaction_fk" FOREIGN KEY ("user_id","transaction_id") REFERENCES "public"."transactions"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_suggestion_rejections" ADD CONSTRAINT "recurring_suggestion_rejections_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_app_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."accounts"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_fk" FOREIGN KEY ("user_id","import_id") REFERENCES "public"."imports"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("user_id","category_id") REFERENCES "public"."categories"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_matched_occurrence_fk" FOREIGN KEY ("user_id","matched_occurrence_id") REFERENCES "public"."recurring_occurrences"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_name_unique" UNIQUE("user_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_iban_idx" ON "accounts" USING btree ("user_id","iban") WHERE "accounts"."iban" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_rejection_key_type_idx" ON "recurring_suggestion_rejections" USING btree ("user_id","key","type");
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_import_hash_idx" ON "transactions" USING btree ("user_id","import_hash");
--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" USING btree ("user_id","date");
--> statement-breakpoint

-- The app's role: not the owner, no BYPASSRLS, so the policies below apply to it. Created without a
-- login; set the password by hand (ALTER ROLE kasboek_app LOGIN PASSWORD '...') where it is used.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kasboek_app') THEN
    CREATE ROLE kasboek_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO kasboek_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kasboek_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kasboek_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.uid() TO kasboek_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kasboek_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kasboek_app;
--> statement-breakpoint

-- One policy per table: a user sees and changes only their own rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','budgets','categories','categorisation_rules','imports',
    'monthly_total_budget','recurring_items','recurring_occurrences','recurring_suggestion_rejections','transactions']
  LOOP
    EXECUTE format('CREATE POLICY tenant ON %I FOR ALL TO kasboek_app USING (user_id = (SELECT app.uid())) WITH CHECK (user_id = (SELECT app.uid()))', t);
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE POLICY tenant ON "app_users" FOR ALL TO kasboek_app USING (user_id = (SELECT app.uid())) WITH CHECK (user_id = (SELECT app.uid()));
