import type {
  PackingListInput,
  PackingListItemInput,
  PackingListOptionInput,
} from './db/packing-lists';

function parseOptions(
  value: unknown,
): { options: PackingListOptionInput[] } | { message: string } {
  // A list without options is the common case, and stays valid unchanged.
  if (value === undefined) return { options: [] };

  if (!Array.isArray(value)) {
    return { message: '`options` must be an array of objects' };
  }

  const options: PackingListOptionInput[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { message: '`options` must be an array of objects' };
    }

    const { id, label, defaultOn } = entry as Record<string, unknown>;

    if (id !== undefined && typeof id !== 'string') {
      return { message: 'Each option `id` must be a string' };
    }
    if (typeof label !== 'string') {
      return { message: 'Each option needs a `label` string' };
    }
    if (defaultOn !== undefined && typeof defaultOn !== 'boolean') {
      return { message: 'Each option `defaultOn` must be a boolean' };
    }

    options.push({ id, label, defaultOn: defaultOn ?? false });
  }

  return { options };
}

function parseItems(
  value: unknown,
): { items: PackingListItemInput[] } | { message: string } {
  if (!Array.isArray(value)) {
    return { message: '`items` must be an array of objects' };
  }

  const items: PackingListItemInput[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { message: '`items` must be an array of objects' };
    }

    const { text, optionIds } = entry as Record<string, unknown>;

    if (typeof text !== 'string') {
      return { message: 'Each item needs a `text` string' };
    }
    if (
      optionIds !== undefined &&
      (!Array.isArray(optionIds) ||
        optionIds.some((id) => typeof id !== 'string'))
    ) {
      return { message: 'Each item `optionIds` must be an array of strings' };
    }

    items.push({ text, optionIds: (optionIds as string[] | undefined) ?? [] });
  }

  return { items };
}

/**
 * Shape-checks the request body before it reaches the data layer, which trusts
 * its types. `normaliseInput` then owns the content rules — trimming, blanks,
 * duplicates and limits — so those live in one place regardless of caller.
 */
export function parsePackingListBody(
  body: Record<string, unknown>,
): { input: PackingListInput } | { message: string } {
  const { title, isPublic } = body;

  if (typeof title !== 'string') {
    return { message: '`title` must be a string' };
  }
  if (typeof isPublic !== 'boolean') {
    return { message: '`isPublic` must be a boolean' };
  }

  const options = parseOptions(body.options);
  if ('message' in options) return options;

  const items = parseItems(body.items);
  if ('message' in items) return items;

  return {
    input: { title, isPublic, items: items.items, options: options.options },
  };
}
