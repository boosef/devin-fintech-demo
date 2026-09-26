CREATE TABLE `audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` text NOT NULL,
	`actor` text NOT NULL,
	`actor_type` text NOT NULL,
	`on_behalf_of` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_records_entity_idx` ON `audit_records` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `refund_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id_enc` text NOT NULL,
	`amount_cents_enc` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`decision_reason` text
);
--> statement-breakpoint
CREATE INDEX `refund_requests_status_requested_at_idx` ON `refund_requests` (`status`,`requested_at`);