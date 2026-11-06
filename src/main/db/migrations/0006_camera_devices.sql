CREATE TABLE `camera_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`username` text,
	`password_encrypted` text,
	`width` integer,
	`height` integer,
	`fps` integer,
	`role` text DEFAULT 'main' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
