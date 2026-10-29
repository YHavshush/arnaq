ALTER TABLE "user_settings" ADD COLUMN "savings_anchor" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "savings_anchor_date" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_savings_anchor_check" CHECK ((savings_anchor is null) = (savings_anchor_date is null) and (savings_anchor is null or savings_anchor >= 0));