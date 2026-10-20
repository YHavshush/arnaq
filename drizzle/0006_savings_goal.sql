ALTER TABLE "user_settings" ADD COLUMN "savings_goal" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "savings_start" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_savings_check" CHECK ((savings_goal is null or savings_goal > 0) and savings_start >= 0);