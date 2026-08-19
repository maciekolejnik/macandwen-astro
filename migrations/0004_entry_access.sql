-- Access notes move from `location_detail` to `entry`: they describe how to
-- reach the entry's representative point, which lives on `entry`, and an
-- activity has a way in as much as a place does.
ALTER TABLE `entry` ADD `access` text;--> statement-breakpoint
UPDATE `entry` SET `access` = (
  SELECT `access` FROM `location_detail` WHERE `location_detail`.`entry_id` = `entry`.`id`
) WHERE `id` IN (SELECT `entry_id` FROM `location_detail` WHERE `access` IS NOT NULL);--> statement-breakpoint
ALTER TABLE `location_detail` DROP COLUMN `access`;
