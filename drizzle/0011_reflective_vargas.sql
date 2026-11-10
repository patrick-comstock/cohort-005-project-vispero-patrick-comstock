DROP INDEX `refund_requests_purchase_idx`;--> statement-breakpoint
ALTER TABLE `refund_requests` ADD `resolution_note` text;--> statement-breakpoint
CREATE UNIQUE INDEX `refund_requests_purchase_unique` ON `refund_requests` (`purchase_id`);--> statement-breakpoint
ALTER TABLE `coupons` ADD `voided_at` text;