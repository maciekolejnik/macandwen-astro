import type { APIRoute } from 'astro';
import { error, json, readJsonObject } from '../../../../lib/api';
import {
  addVisit,
  PlacesValidationError,
  removeVisit,
} from '../../../../lib/db/places';

export const prerender = false;

const NOT_FOUND = 'Place not found';

/**
 * A visit is the visitor's own, so anyone who can see an entry may record one
 * — including on somebody else's public entry. What comes back is only ever
 * their own visits, which is the rule `visitsFor` enforces.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to record a visit');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body) return error(400, 'Expected a JSON object');
  if (typeof body.visitedOn !== 'string') {
    return error(400, '`visitedOn` must be a date, as YYYY-MM-DD');
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return error(400, '`note` must be a string');
  }

  try {
    const visits = await addVisit(
      id,
      locals.user,
      body.visitedOn,
      (body.note as string | null | undefined) ?? null,
    );
    if (!visits) return error(404, NOT_FOUND);

    return json({ visits });
  } catch (cause) {
    if (cause instanceof PlacesValidationError) return error(400, cause.message);
    throw cause;
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to remove a visit');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body || typeof body.visitId !== 'string') {
    return error(400, '`visitId` must be a string');
  }

  const visits = await removeVisit(id, body.visitId, locals.user);
  if (!visits) return error(404, NOT_FOUND);

  return json({ visits });
};
