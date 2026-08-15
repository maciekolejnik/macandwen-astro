CREATE TABLE `packing_list` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_list_userId_idx` ON `packing_list` (`user_id`);--> statement-breakpoint
CREATE INDEX `packing_list_public_createdAt_idx` ON `packing_list` (`is_public`,`created_at`);--> statement-breakpoint
CREATE TABLE `packing_list_favourite` (
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `list_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `packing_list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_list_favourite_listId_idx` ON `packing_list_favourite` (`list_id`);--> statement-breakpoint
CREATE TABLE `packing_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`text` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `packing_list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_list_item_listId_position_idx` ON `packing_list_item` (`list_id`,`position`);