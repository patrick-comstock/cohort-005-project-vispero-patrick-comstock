-- Rename the refunds table to refund_requests in place, keeping every row.
ALTER TABLE `refunds` RENAME TO `refund_requests`;--> statement-breakpoint
ALTER TABLE `refund_requests` RENAME COLUMN `amount_refunded` TO `refund_amount`;--> statement-breakpoint
DROP INDEX `refunds_purchase_idx`;--> statement-breakpoint
CREATE INDEX `refund_requests_purchase_idx` ON `refund_requests` (`purchase_id`);--> statement-breakpoint
UPDATE `refund_requests` SET `status` = 'pending' WHERE `status` = 'requested';--> statement-breakpoint
-- SQLite cannot change a column default in place, so rebuild the table to
-- change the status default from 'requested' to 'pending'. Rows and ids are
-- copied across unchanged.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_refund_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text NOT NULL,
	`refund_amount` integer,
	`requested_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` integer,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_refund_requests`("id", "purchase_id", "status", "reason", "refund_amount", "requested_at", "resolved_at", "resolved_by_user_id") SELECT "id", "purchase_id", "status", "reason", "refund_amount", "requested_at", "resolved_at", "resolved_by_user_id" FROM `refund_requests`;--> statement-breakpoint
DROP TABLE `refund_requests`;--> statement-breakpoint
ALTER TABLE `__new_refund_requests` RENAME TO `refund_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `refund_requests_purchase_idx` ON `refund_requests` (`purchase_id`);
