/**
 * Kept apart from `db/packing-lists.ts` so the browser can import them without
 * pulling in Drizzle and the D1 binding along with them.
 *
 * Longer values are a mistake or an abuse, not a packing list.
 */
export const TITLE_MAX_LENGTH = 120;
export const ITEM_MAX_LENGTH = 200;
export const MAX_ITEMS = 500;

/**
 * Eight options is 256 combinations — already more than a list can honestly
 * describe — and a toggle row past that stops being scannable in one glance.
 */
export const MAX_OPTIONS = 8;
export const OPTION_LABEL_MAX_LENGTH = 40;
