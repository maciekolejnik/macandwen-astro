import type { APIRoute } from 'astro';
import { error, json } from '../../../../lib/api';
import { setFavourite } from '../../../../lib/db/packing-lists';

export const prerender = false;

/**
 * A list that cannot be saved is answered the same way whether it is missing,
 * private or the caller's own, so this route cannot be used to learn which ids
 * exist — the same rule the other packing list routes follow.
 */
const UNAVAILABLE = 'That packing list cannot be saved';

const setSaved = (saved: boolean): APIRoute =>
  async ({ params, locals }) => {
    if (!locals.user) return error(401, 'Sign in to save a packing list');

    const id = params.id;
    if (!id) return error(404, UNAVAILABLE);

    const result = await setFavourite(id, locals.user.id, saved);
    if (!result) return error(404, UNAVAILABLE);

    return json({ saved: result.favourite, count: result.favouriteCount });
  };

export const POST = setSaved(true);
export const DELETE = setSaved(false);
