/**
 * Which items of a list apply to the trip the visitor is packing for.
 *
 * A list carries independent yes/no options — "Cooking", "Wild camping" — and
 * items may be tagged with them. Knowing nothing of the DOM or the database,
 * so the page and its tests decide visibility by the same rule.
 */

export type PackingListOption = {
  id: string;
  label: string;
  position: number;
  defaultOn: boolean;
};

/**
 * An item with no options is always packed; one with options is packed when
 * *any* of them is on.
 *
 * Any, not all: something tagged both "Cooking" and "Wild camping" reads as
 * "needed if either applies", which is how a person tags an item they are
 * unsure about. Requiring all would hide items precisely when the visitor said
 * yes to more, and more trip means more kit, not less.
 */
export function isItemVisible(
  itemOptionIds: readonly string[],
  activeOptionIds: ReadonlySet<string>,
): boolean {
  if (itemOptionIds.length === 0) return true;

  return itemOptionIds.some((id) => activeOptionIds.has(id));
}

/** The options that start on for a visitor who has never touched the toggles. */
export function defaultActiveOptions(
  options: readonly PackingListOption[],
): Set<string> {
  return new Set(
    options.filter((option) => option.defaultOn).map((option) => option.id),
  );
}

/**
 * Stored state is explicit per option, so an option added to the list since it
 * was written falls back to its default rather than silently starting off, and
 * an option since deleted simply drops out.
 */
export function resolveActiveOptions(
  options: readonly PackingListOption[],
  stored: Readonly<Record<string, boolean>> | null,
): Set<string> {
  if (!stored) return defaultActiveOptions(options);

  return new Set(
    options
      .filter((option) => stored[option.id] ?? option.defaultOn)
      .map((option) => option.id),
  );
}
