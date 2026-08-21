CREATE TABLE `packing_list_item_option` (
	`item_id` text NOT NULL,
	`option_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `option_id`),
	FOREIGN KEY (`item_id`) REFERENCES `packing_list_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_id`) REFERENCES `packing_list_option`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_list_item_option_optionId_idx` ON `packing_list_item_option` (`option_id`);--> statement-breakpoint
CREATE TABLE `packing_list_option` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`default_on` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `packing_list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `packing_list_option_listId_position_idx` ON `packing_list_option` (`list_id`,`position`);
