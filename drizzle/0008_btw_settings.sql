ALTER TABLE "user_settings" ADD COLUMN "btw_client" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "btw_pocket" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_btw_check" CHECK ((btw_client is null or char_length(btw_client) between 1 and 60) and (btw_pocket is null or char_length(btw_pocket) between 1 and 60));