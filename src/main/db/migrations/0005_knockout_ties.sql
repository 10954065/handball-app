CREATE TABLE `knockout_ties` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`stage` text NOT NULL,
	`position` integer NOT NULL,
	`home_team_id` text,
	`away_team_id` text,
	`match_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knockout_ties_uq` ON `knockout_ties` (`season_id`,`stage`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `knockout_ties_match_uq` ON `knockout_ties` (`match_id`);