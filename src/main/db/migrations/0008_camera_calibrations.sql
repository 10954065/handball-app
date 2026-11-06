CREATE TABLE `camera_calibrations` (
	`camera_id` text PRIMARY KEY NOT NULL,
	`goal_areas` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`camera_id`) REFERENCES `camera_devices`(`id`) ON UPDATE no action ON DELETE cascade
);
