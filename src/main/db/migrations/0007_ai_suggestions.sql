CREATE TABLE `ai_event_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`category` text NOT NULL,
	`side` text,
	`roster_id` text,
	`jersey` integer,
	`track_id` integer,
	`confidence` real NOT NULL,
	`camera_id` text,
	`period_seq` integer NOT NULL,
	`match_ms` integer NOT NULL,
	`evidence` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`event_id` text,
	`correction` text,
	`reason` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roster_id`) REFERENCES `match_rosters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`camera_id`) REFERENCES `camera_devices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`event_id`) REFERENCES `match_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_suggestions_match_idx` ON `ai_event_suggestions` (`match_id`,`status`);