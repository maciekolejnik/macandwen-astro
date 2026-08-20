import type { APIRoute } from 'astro';
import { error, json, readJsonObject } from '../../../../lib/api';
import {
  addLink,
  PlacesValidationError,
  removeLink,
} from '../../../../lib/db/places';

export const prerender = false;

const NOT_FOUND = 'Place not found';

/**
 * Linking is editing, so it is owner-only, and the far end has to be visible
 * to the actor — otherwise the response would confirm that a private entry
 * exists by accepting a link to it.
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to link places');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body) return error(400, 'Expected a JSON object');
  if (typeof body.toEntryId !== 'string' || typeof body.relation !== 'string') {
    return error(400, '`toEntryId` and `relation` must be strings');
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return error(400, '`note` must be a string');
  }

  try {
    const links = await addLink(
      id,
      body.toEntryId,
      body.relation,
      locals.user,
      (body.note as string | null | undefined) ?? null,
    );
    if (!links) return error(404, NOT_FOUND);

    return json({ links });
  } catch (cause) {
    if (cause instanceof PlacesValidationError) return error(400, cause.message);
    throw cause;
  }
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  if (!locals.user) return error(401, 'Sign in to remove a link');

  const id = params.id;
  if (!id) return error(404, NOT_FOUND);

  const body = await readJsonObject(request);
  if (!body || typeof body.linkId !== 'string') {
    return error(400, '`linkId` must be a string');
  }

  const links = await removeLink(id, body.linkId, locals.user);
  if (!links) return error(404, NOT_FOUND);

  return json({ links });
};
