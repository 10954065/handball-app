ALTER TABLE `match_reports` ADD `match_state` text NOT NULL;--> statement-breakpoint
ALTER TABLE `match_reports` ADD `ledger_digest` text NOT NULL;--> statement-breakpoint
ALTER TABLE `match_reports` ADD `content_key` text NOT NULL;--> statement-breakpoint
ALTER TABLE `player_statistics` ADD `is_goalkeeper` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `player_statistics` ADD `played` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `player_statistics` ADD `seven_metre_shots` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player_statistics` ADD `seven_metre_faced` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `seven_metre_goals` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `seven_metre_shots` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `steals` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `blocks` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `warnings` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `disqualifications` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `goals_conceded` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `seven_metre_saves` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team_statistics` ADD `seven_metre_faced` integer DEFAULT 0 NOT NULL;