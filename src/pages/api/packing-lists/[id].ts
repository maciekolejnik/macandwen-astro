import type { APIRoute } from 'astro';
import { error, json, readJsonObject } from '../../../lib/api';
import {
  PackingListValidationError,
  remove,
  update,
} from '../../../lib/db/packing-lists';
import { parsePackingListBody } from '../../../lib/packing-list-payload';

export const prerender = false;

/**
 * A list that does not exist and one owned by someone else are answered
 * identically, so nobody can use this route to discover which ids are real.
 */
const NOT_FOUND = 'Packing list not found';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to edit a packing list');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body) return error(400, 'Expected a JSON object');

  const parsed = parsePackingListBody(body);
  if ('message' in parsed) return error(400, parsed.message);

  try {
    const updated = await update(id, locals.user.id, parsed.input);
    if (!updated) return error(404, NOT_FOUND);

    return json({ id });
  } catch (cause) {
    if (cause instanceof PackingListValidationError) {
      return error(400, cause.message);
    }
    throw cause;
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return error(401, 'Sign in to delete a packing list');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const deleted = await remove(id, locals.user.id);
  if (!deleted) return error(404, NOT_FOUND);

  return json({ id });
};
