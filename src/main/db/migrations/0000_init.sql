CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`username` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`match_id` text,
	`before` text,
	`after` text,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_at_idx` ON `audit_logs` (`at`);--> statement-breakpoint
CREATE INDEX `audit_logs_match_idx` ON `audit_logs` (`match_id`);--> statement-breakpoint
CREATE TABLE `backup_history` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`file_path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`integrity` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `competitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`type` text NOT NULL,
	`category` text,
	`organizer` text,
	`rules` text NOT NULL,
	`points_win` integer DEFAULT 2 NOT NULL,
	`points_draw` integer DEFAULT 1 NOT NULL,
	`points_loss` integer DEFAULT 0 NOT NULL,
	`tiebreakers` text NOT NULL,
	`logo_media_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`logo_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `match_clock` (
	`match_id` text PRIMARY KEY NOT NULL,
	`phase` text NOT NULL,
	`period_seq` integer DEFAULT 0 NOT NULL,
	`running` integer DEFAULT false NOT NULL,
	`base_ms` integer DEFAULT 0 NOT NULL,
	`run_started_wall` integer,
	`checkpoint_ms` integer DEFAULT 0 NOT NULL,
	`checkpoint_wall` integer,
	`timeout_id` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`side` text,
	`roster_id` text,
	`team_official_id` text,
	`period_seq` integer NOT NULL,
	`match_ms` integer NOT NULL,
	`outcome` text,
	`situation` text,
	`zone` text,
	`assist_roster_id` text,
	`goalkeeper_roster_id` text,
	`in_roster_id` text,
	`blue_card` integer DEFAULT false NOT NULL,
	`team_reduction` integer DEFAULT false NOT NULL,
	`caused_by_event_id` text,
	`reason` text,
	`status` text DEFAULT 'active' NOT NULL,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	`replaces_event_id` text,
	`client_request_id` text,
	`recorded_by` text,
	`wall_time` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roster_id`) REFERENCES `match_rosters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_official_id`) REFERENCES `match_team_officials`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assist_roster_id`) REFERENCES `match_rosters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`goalkeeper_roster_id`) REFERENCES `match_rosters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`in_roster_id`) REFERENCES `match_rosters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_events_seq_uq` ON `match_events` (`match_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_events_request_uq` ON `match_events` (`match_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `match_events_match_idx` ON `match_events` (`match_id`,`status`);--> statement-breakpoint
CREATE INDEX `match_events_roster_idx` ON `match_events` (`roster_id`);--> statement-breakpoint
CREATE TABLE `match_lineups` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`side` text NOT NULL,
	`team_id` text NOT NULL,
	`coach_name` text,
	`confirmed_at` integer,
	`confirmed_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_lineups_uq` ON `match_lineups` (`match_id`,`side`);--> statement-breakpoint
CREATE TABLE `match_officials` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`official_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`official_id`) REFERENCES `officials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `match_officials_match_idx` ON `match_officials` (`match_id`);--> statement-breakpoint
CREATE TABLE `match_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`home_score` integer,
	`away_score` integer,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_periods_uq` ON `match_periods` (`match_id`,`seq`);--> statement-breakpoint
CREATE TABLE `match_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`format` text NOT NULL,
	`template` text NOT NULL,
	`file_name` text NOT NULL,
	`bytes` blob NOT NULL,
	`generated_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `match_reports_match_idx` ON `match_reports` (`match_id`);--> statement-breakpoint
CREATE TABLE `match_rosters` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`side` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	`jersey_number` integer NOT NULL,
	`player_name` text NOT NULL,
	`position` text,
	`photo_media_id` text,
	`is_goalkeeper` integer DEFAULT false NOT NULL,
	`is_captain` integer DEFAULT false NOT NULL,
	`is_starting` integer DEFAULT false NOT NULL,
	`is_starting_gk` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_rosters_jersey_uq` ON `match_rosters` (`match_id`,`side`,`jersey_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_rosters_player_uq` ON `match_rosters` (`match_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `match_rosters_match_idx` ON `match_rosters` (`match_id`);--> statement-breakpoint
CREATE TABLE `match_team_officials` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`side` text NOT NULL,
	`slot` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_team_officials_uq` ON `match_team_officials` (`match_id`,`side`,`slot`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`match_number` text NOT NULL,
	`competition_id` text,
	`season_id` text,
	`home_team_id` text NOT NULL,
	`away_team_id` text NOT NULL,
	`venue_id` text,
	`scheduled_at` integer NOT NULL,
	`stage` text DEFAULT 'league' NOT NULL,
	`round` integer,
	`group_name` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`rules` text NOT NULL,
	`home_team_name` text NOT NULL,
	`away_team_name` text NOT NULL,
	`home_color` text NOT NULL,
	`away_color` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`home_half_time` integer,
	`away_half_time` integer,
	`home_shootout` integer,
	`away_shootout` integer,
	`winner_side` text,
	`decided_by` text,
	`spectators` integer,
	`notes` text,
	`amended` integer DEFAULT false NOT NULL,
	`started_at` integer,
	`finalized_at` integer,
	`finalized_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`finalized_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_number_uq` ON `matches` (`match_number`);--> statement-breakpoint
CREATE INDEX `matches_status_idx` ON `matches` (`status`);--> statement-breakpoint
CREATE INDEX `matches_scheduled_idx` ON `matches` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `matches_season_idx` ON `matches` (`season_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`bytes` blob NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `officials` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`license_no` text,
	`region` text,
	`phone` text,
	`email` text,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `player_statistics` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`player_id` text NOT NULL,
	`team_id` text NOT NULL,
	`roster_id` text NOT NULL,
	`goals` integer DEFAULT 0 NOT NULL,
	`seven_metre_goals` integer DEFAULT 0 NOT NULL,
	`shots` integer DEFAULT 0 NOT NULL,
	`assists` integer DEFAULT 0 NOT NULL,
	`steals` integer DEFAULT 0 NOT NULL,
	`blocks` integer DEFAULT 0 NOT NULL,
	`turnovers` integer DEFAULT 0 NOT NULL,
	`technical_faults` integer DEFAULT 0 NOT NULL,
	`warnings` integer DEFAULT 0 NOT NULL,
	`suspensions` integer DEFAULT 0 NOT NULL,
	`disqualifications` integer DEFAULT 0 NOT NULL,
	`saves` integer DEFAULT 0 NOT NULL,
	`shots_faced` integer DEFAULT 0 NOT NULL,
	`goals_conceded` integer DEFAULT 0 NOT NULL,
	`seven_metre_saves` integer DEFAULT 0 NOT NULL,
	`playing_time_ms` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_statistics_uq` ON `player_statistics` (`match_id`,`roster_id`);--> statement-breakpoint
CREATE INDEX `player_statistics_player_idx` ON `player_statistics` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`registration_no` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`date_of_birth` text,
	`gender` text,
	`nationality` text,
	`position` text,
	`height_cm` integer,
	`is_goalkeeper` integer DEFAULT false NOT NULL,
	`photo_media_id` text,
	`registration_status` text DEFAULT 'registered' NOT NULL,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`photo_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_regno_uq` ON `players` (`registration_no`);--> statement-breakpoint
CREATE INDEX `players_name_idx` ON `players` (`last_name`,`first_name`);--> statement-breakpoint
CREATE TABLE `season_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`team_id` text NOT NULL,
	`group_name` text,
	`seed` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `season_teams_uq` ON `season_teams` (`season_id`,`team_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seasons_comp_idx` ON `seasons` (`competition_id`);--> statement-breakpoint
CREATE TABLE `standings` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`group_name` text DEFAULT '' NOT NULL,
	`team_id` text NOT NULL,
	`rank` integer NOT NULL,
	`played` integer NOT NULL,
	`won` integer NOT NULL,
	`drawn` integer NOT NULL,
	`lost` integer NOT NULL,
	`goals_for` integer NOT NULL,
	`goals_against` integer NOT NULL,
	`points` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `standings_uq` ON `standings` (`season_id`,`group_name`,`team_id`);--> statement-breakpoint
CREATE TABLE `substitutions` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`event_id` text NOT NULL,
	`side` text NOT NULL,
	`out_roster_id` text,
	`in_roster_id` text,
	`period_seq` integer NOT NULL,
	`match_ms` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `match_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `substitutions_match_idx` ON `substitutions` (`match_id`);--> statement-breakpoint
CREATE TABLE `suspensions` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`event_id` text NOT NULL,
	`side` text NOT NULL,
	`team_id` text NOT NULL,
	`roster_id` text,
	`player_id` text,
	`team_official_id` text,
	`kind` text NOT NULL,
	`sequence` integer NOT NULL,
	`period_seq` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`reason` text,
	`recorded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `match_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suspensions_match_idx` ON `suspensions` (`match_id`,`status`);--> statement-breakpoint
CREATE INDEX `suspensions_player_idx` ON `suspensions` (`player_id`);--> statement-breakpoint
CREATE TABLE `team_players` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	`jersey_number` integer NOT NULL,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_players_active_jersey_uq` ON `team_players` (`team_id`,`jersey_number`) WHERE "team_players"."left_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `team_players_active_player_uq` ON `team_players` (`player_id`) WHERE "team_players"."left_at" IS NULL;--> statement-breakpoint
CREATE INDEX `team_players_team_idx` ON `team_players` (`team_id`);--> statement-breakpoint
CREATE TABLE `team_statistics` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text NOT NULL,
	`side` text NOT NULL,
	`goals` integer DEFAULT 0 NOT NULL,
	`shots` integer DEFAULT 0 NOT NULL,
	`shooting_pct` real,
	`technical_faults` integer DEFAULT 0 NOT NULL,
	`turnovers` integer DEFAULT 0 NOT NULL,
	`suspensions` integer DEFAULT 0 NOT NULL,
	`timeouts` integer DEFAULT 0 NOT NULL,
	`saves` integer DEFAULT 0 NOT NULL,
	`save_pct` real,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_statistics_uq` ON `team_statistics` (`match_id`,`side`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`code` text NOT NULL,
	`country` text,
	`region` text,
	`club_name` text,
	`home_venue` text,
	`coach` text,
	`assistant_coach` text,
	`team_manager` text,
	`primary_color` text DEFAULT '#2563eb' NOT NULL,
	`secondary_color` text DEFAULT '#ffffff' NOT NULL,
	`logo_media_id` text,
	`captain_player_id` text,
	`primary_goalkeeper_id` text,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`logo_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `teams_name_idx` ON `teams` (`name`);--> statement-breakpoint
CREATE TABLE `timeouts` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`event_id` text NOT NULL,
	`side` text NOT NULL,
	`team_id` text NOT NULL,
	`period_seq` integer NOT NULL,
	`match_ms` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`started_wall` integer NOT NULL,
	`ended_wall` integer,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `match_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `timeouts_match_idx` ON `timeouts` (`match_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (lower("username"));--> statement-breakpoint
CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text,
	`address` text,
	`capacity` integer,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
