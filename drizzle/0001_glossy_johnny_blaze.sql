CREATE TABLE `recurring_suggestion_rejections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`rejected_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_rejection_key_type_idx` ON `recurring_suggestion_rejections` (`key`,`type`);--> statement-breakpoint
CREATE INDEX `occurrence_status_idx` ON `recurring_occurrences` (`status`);