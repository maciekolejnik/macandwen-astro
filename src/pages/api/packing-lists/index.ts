import type { APIRoute } from 'astro';
import { error, json, readJsonObject } from '../../../lib/api';
import {
  create,
  PackingListValidationError,
} from '../../../lib/db/packing-lists';
import { parsePackingListBody } from '../../../lib/packing-list-payload';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to create a packing list');

  const body = await readJsonObject(request);
  if (!body) return error(400, 'Expected a JSON object');

  const parsed = parsePackingListBody(body);
  if ('message' in parsed) return error(400, parsed.message);

  try {
    const id = await create(locals.user.id, parsed.input);

    return json({ id }, 201);
  } catch (cause) {
    if (cause instanceof PackingListValidationError) {
      return error(400, cause.message);
    }
    throw cause;
  }
};
