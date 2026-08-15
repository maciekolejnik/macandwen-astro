import type { PackingListInput } from './db/packing-lists';

/**
 * Shape-checks the request body before it reaches the data layer, which trusts
 * its types. `normaliseInput` then owns the content rules — trimming, blanks
 * and limits — so those live in one place regardless of caller.
 */
export function parsePackingListBody(
  body: Record<string, unknown>,
): { input: PackingListInput } | { message: string } {
  const { title, isPublic, items } = body;

  if (typeof title !== 'string') {
    return { message: '`title` must be a string' };
  }
  if (typeof isPublic !== 'boolean') {
    return { message: '`isPublic` must be a boolean' };
  }
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
    return { message: '`items` must be an array of strings' };
  }

  return { input: { title, isPublic, items: items as string[] } };
}
