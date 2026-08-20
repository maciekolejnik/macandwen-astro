import type { APIRoute } from 'astro';
import { error, json, readJsonObject } from '../../../lib/api';
import { create, PlacesValidationError } from '../../../lib/db/places';
import { parsePlaceBody } from '../../../lib/places-payload';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to add a place');

  const body = await readJsonObject(request);
  if (!body) return error(400, 'Expected a JSON object');

  const parsed = parsePlaceBody(body);
  if ('message' in parsed) return error(400, parsed.message);

  try {
    const created = await create(locals.user, parsed.input);

    return json(created, 201);
  } catch (cause) {
    if (cause instanceof PlacesValidationError) return error(400, cause.message);
    throw cause;
  }
};
