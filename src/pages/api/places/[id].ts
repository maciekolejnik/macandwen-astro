import type { APIRoute } from 'astro';
import { error, json, readJsonObject } from '../../../lib/api';
import { PlacesValidationError, remove, update } from '../../../lib/db/places';
import { parsePlaceBody } from '../../../lib/places-payload';

export const prerender = false;

/**
 * An entry that does not exist, one that is private to somebody else, and one
 * the visitor may see but not edit are answered identically — otherwise the
 * difference between the three tells you which ids are real.
 */
const NOT_FOUND = 'Place not found';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to edit a place');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body) return error(400, 'Expected a JSON object');

  const parsed = parsePlaceBody(body);
  if ('message' in parsed) return error(400, parsed.message);

  try {
    const updated = await update(id, locals.user, parsed.input);
    if (!updated) return error(404, NOT_FOUND);

    // The slug is frozen at creation, so the client already knows where to go.
    return json({ id });
  } catch (cause) {
    if (cause instanceof PlacesValidationError) return error(400, cause.message);
    throw cause;
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.user) return error(401, 'Sign in to delete a place');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const deleted = await remove(id, locals.user);
  if (!deleted) return error(404, NOT_FOUND);

  return json({ id });
};
