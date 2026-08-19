CREATE TABLE `activity_detail` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`difficulty` text,
	`duration_bucket` text,
	`duration_minutes` integer,
	`family_friendly` integer,
	`distance_m` integer,
	`ascent_m` integer,
	`attributes` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `entry_type`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entry` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`user_id` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`lat` real,
	`lng` real,
	`extent` text DEFAULT 'point' NOT NULL,
	`bbox_min_lat` real,
	`bbox_min_lng` real,
	`bbox_max_lat` real,
	`bbox_max_lng` real,
	`seasons` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entry_slug_unique` ON `entry` (`slug`);--> statement-breakpoint
CREATE INDEX `entry_userId_idx` ON `entry` (`user_id`);--> statement-breakpoint
CREATE INDEX `entry_visibility_createdAt_idx` ON `entry` (`visibility`,`created_at`);--> statement-breakpoint
CREATE INDEX `entry_lat_lng_idx` ON `entry` (`lat`,`lng`);--> statement-breakpoint
CREATE TABLE `entry_link` (
	`id` text PRIMARY KEY NOT NULL,
	`from_entry_id` text NOT NULL,
	`to_entry_id` text NOT NULL,
	`relation` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`from_entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_link_from_idx` ON `entry_link` (`from_entry_id`);--> statement-breakpoint
CREATE INDEX `entry_link_to_idx` ON `entry_link` (`to_entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_link_unq` ON `entry_link` (`from_entry_id`,`to_entry_id`,`relation`);--> statement-breakpoint
CREATE TABLE `entry_photo` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_photo_entryId_position_idx` ON `entry_photo` (`entry_id`,`position`);--> statement-breakpoint
CREATE TABLE `entry_type` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`icon` text,
	`colour` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entry_type_kind_position_idx` ON `entry_type` (`kind`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_type_kind_slug_unq` ON `entry_type` (`kind`,`slug`);--> statement-breakpoint
CREATE TABLE `entry_visit` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`visited_on` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_visit_entryId_idx` ON `entry_visit` (`entry_id`);--> statement-breakpoint
CREATE INDEX `entry_visit_userId_idx` ON `entry_visit` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entry_visit_unq` ON `entry_visit` (`entry_id`,`user_id`,`visited_on`);--> statement-breakpoint
CREATE TABLE `location_detail` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`access` text,
	`attributes` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `entry_type`(`id`) ON UPDATE no action ON DELETE no action
);
