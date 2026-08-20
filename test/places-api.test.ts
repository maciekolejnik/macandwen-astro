import { describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { onRequest } from '../src/middleware';
import { POST } from '../src/pages/api/places/index';
import { DELETE, PATCH } from '../src/pages/api/places/[id]';
import {
  POST as ADD_VISIT,
  DELETE as REMOVE_VISIT,
} from '../src/pages/api/places/[id]/visits';
import {
  POST as ADD_LINK,
  DELETE as REMOVE_LINK,
} from '../src/pages/api/places/[id]/links';
import { create, getById } from '../src/lib/db/places';
import { BASE_URL, signedInUser } from './helpers';

type Handler = (context: APIContext) => Promise<Response> | Response;

/**
 * The same harness as `packing-lists-api.test.ts`: Astro's real context needs a
 * dev server, so this assembles what the routes read and fills `locals` by
 * running the actual middleware over the actual cookie — authentication is
 * exercised rather than assumed.
 */
async function call(
  handler: Handler,
  {
    path,
    method,
    body,
    cookie,
    params = {},
  }: {
    path: string;
    method: string;
    body?: unknown;
    cookie?: string;
    params?: Record<string, string>;
  },
) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');

  const url = new URL(path, BASE_URL);
  const request = new Request(url, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
  });

  const context = { url, request, params, locals: {} as App.Locals };

  await onRequest(context as unknown as APIContext, async () =>
    Response.json(null),
  );

  const response = await handler(context as unknown as APIContext);

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

const LAKE = 'loc_lake';
const HIKE = 'act_hike';
const CAR_PARK = 'loc_car_park';

describe('POST /api/places', () => {
  it('creates an entry and answers with where it went', async () => {
    const user = await signedInUser();

    const { status, body } = await call(POST, {
      path: '/api/places',
      method: 'POST',
      cookie: user.headers.cookie,
      body: {
        name: 'Estany de Banyoles',
        lat: '42.1256',
        lng: '2.7469',
        location: { typeId: LAKE },
        activity: { typeId: 'act_wild_swim', familyFriendly: 'yes' },
        photos: [{ url: 'https://media.macandwen.com/a.webp', caption: '' }],
      },
    });

    expect(status).toBe(201);
    expect(body.slug).toBe('estany-de-banyoles');

    const place = await getById(body.id as string, user);
    // Both halves given, so the kind is derived rather than asked for.
    expect(place?.kind).toBe('both');
    expect(place?.lat).toBe(42.1256);
    expect(place?.activity?.familyFriendly).toBe(true);
    expect(place?.photos).toHaveLength(1);
    // An empty caption is a blank field, not a caption of ''.
    expect(place?.photos[0]?.caption).toBeNull();
  });

  it('turns a signed-out visitor away', async () => {
    const { status } = await call(POST, {
      path: '/api/places',
      method: 'POST',
      body: { name: 'Nowhere', location: { typeId: LAKE } },
    });

    expect(status).toBe(401);
  });

  it('refuses a body that is not JSON', async () => {
    const user = await signedInUser();

    const { status } = await call(POST, {
      path: '/api/places',
      method: 'POST',
      cookie: user.headers.cookie,
      body: 'name=Nowhere',
    });

    expect(status).toBe(400);
  });

  it('names the field that is wrong', async () => {
    const user = await signedInUser();

    const { status, body } = await call(POST, {
      path: '/api/places',
      method: 'POST',
      cookie: user.headers.cookie,
      body: { name: 'Somewhere', lat: 'north a bit', location: { typeId: LAKE } },
    });

    expect(status).toBe(400);
    expect(body.error).toContain('lat');
  });

  it('passes a validation failure through as a 400, not a 500', async () => {
    const user = await signedInUser();

    const { status, body } = await call(POST, {
      path: '/api/places',
      method: 'POST',
      cookie: user.headers.cookie,
      body: { name: 'Neither one thing nor the other' },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/place|thing to do/i);
  });
});

describe('PATCH and DELETE /api/places/[id]', () => {
  it('lets the owner edit', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, {
      name: 'The ridge',
      activity: { typeId: HIKE },
    });

    const { status } = await call(PATCH, {
      path: `/api/places/${id}`,
      method: 'PATCH',
      cookie: owner.headers.cookie,
      params: { id },
      body: {
        name: 'The ridge',
        access: 'Park before the gate',
        activity: { typeId: HIKE, difficulty: 'moderate' },
      },
    });

    expect(status).toBe(200);

    const place = await getById(id, owner);
    expect(place?.access).toBe('Park before the gate');
    expect(place?.activity?.difficulty).toBe('moderate');
  });

  it('refuses an admin editing somebody else', async () => {
    const owner = await signedInUser();
    const admin = await signedInUser({ role: 'admin' });
    const { id } = await create(owner, {
      name: 'Not the admin\u2019s',
      location: { typeId: LAKE },
    });

    // Being an admin is not being the owner, and the refusal has to look the
    // same as the entry not existing.
    const { status, body } = await call(PATCH, {
      path: `/api/places/${id}`,
      method: 'PATCH',
      cookie: admin.headers.cookie,
      params: { id },
      body: { name: 'Mine now', location: { typeId: LAKE } },
    });

    expect(status).toBe(404);
    expect(body.error).toBe('Place not found');

    const missing = await call(PATCH, {
      path: '/api/places/nope',
      method: 'PATCH',
      cookie: admin.headers.cookie,
      params: { id: 'nope' },
      body: { name: 'Mine now', location: { typeId: LAKE } },
    });

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(body);
  });

  it('lets the owner delete, and nobody else', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const { id } = await create(owner, {
      name: 'Going away',
      location: { typeId: LAKE },
    });

    const refused = await call(DELETE, {
      path: `/api/places/${id}`,
      method: 'DELETE',
      cookie: other.headers.cookie,
      params: { id },
    });
    expect(refused.status).toBe(404);
    expect(await getById(id, owner)).not.toBeNull();

    const { status } = await call(DELETE, {
      path: `/api/places/${id}`,
      method: 'DELETE',
      cookie: owner.headers.cookie,
      params: { id },
    });

    expect(status).toBe(200);
    expect(await getById(id, owner)).toBeNull();
  });
});

describe('visits', () => {
  it('records and removes the visitor\u2019s own visit', async () => {
    const user = await signedInUser();
    const { id } = await create(user, {
      name: 'Somewhere to go back to',
      location: { typeId: LAKE },
    });

    const added = await call(ADD_VISIT, {
      path: `/api/places/${id}/visits`,
      method: 'POST',
      cookie: user.headers.cookie,
      params: { id },
      body: { visitedOn: '2025-08-14', note: 'Warm water' },
    });

    expect(added.status).toBe(200);
    const visits = added.body.visits as { id: string; note: string }[];
    expect(visits).toHaveLength(1);

    const removed = await call(REMOVE_VISIT, {
      path: `/api/places/${id}/visits`,
      method: 'DELETE',
      cookie: user.headers.cookie,
      params: { id },
      body: { visitId: visits[0]!.id },
    });

    expect(removed.body.visits).toEqual([]);
  });

  it('rejects a date that is not a date', async () => {
    const user = await signedInUser();
    const { id } = await create(user, {
      name: 'Somewhere else',
      location: { typeId: LAKE },
    });

    const { status } = await call(ADD_VISIT, {
      path: `/api/places/${id}/visits`,
      method: 'POST',
      cookie: user.headers.cookie,
      params: { id },
      body: { visitedOn: 'last summer' },
    });

    expect(status).toBe(400);
  });

  it('lets someone record a visit to an entry they do not own', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const visitor = await signedInUser();
    const { id } = await create(admin, {
      name: 'Somewhere public',
      visibility: 'public',
      location: { typeId: LAKE },
    });

    const { status, body } = await call(ADD_VISIT, {
      path: `/api/places/${id}/visits`,
      method: 'POST',
      cookie: visitor.headers.cookie,
      params: { id },
      body: { visitedOn: '2025-08-14' },
    });

    expect(status).toBe(200);
    expect(body.visits).toHaveLength(1);
    // Theirs, and only theirs: the owner's view of the same entry is empty.
    expect((await getById(id, admin))?.visits).toEqual([]);
  });
});

describe('links', () => {
  it('links two entries and unlinks them again', async () => {
    const owner = await signedInUser();
    const walk = await create(owner, {
      name: 'The walk',
      activity: { typeId: HIKE },
    });
    const parking = await create(owner, {
      name: 'The car park',
      location: { typeId: CAR_PARK },
    });

    const added = await call(ADD_LINK, {
      path: `/api/places/${walk.id}/links`,
      method: 'POST',
      cookie: owner.headers.cookie,
      params: { id: walk.id },
      body: { toEntryId: parking.id, relation: 'parks_at', note: 'Fills early' },
    });

    expect(added.status).toBe(200);
    const links = added.body.links as { id: string; label: string }[];
    expect(links).toHaveLength(1);
    expect(links[0]?.label).toBe('Park at');

    const removed = await call(REMOVE_LINK, {
      path: `/api/places/${walk.id}/links`,
      method: 'DELETE',
      cookie: owner.headers.cookie,
      params: { id: walk.id },
      body: { linkId: links[0]!.id },
    });

    expect(removed.body.links).toEqual([]);
  });

  it('refuses a relation it does not know', async () => {
    const owner = await signedInUser();
    const from = await create(owner, {
      name: 'From here',
      location: { typeId: LAKE },
    });
    const to = await create(owner, {
      name: 'To there',
      location: { typeId: CAR_PARK },
    });

    const { status, body } = await call(ADD_LINK, {
      path: `/api/places/${from.id}/links`,
      method: 'POST',
      cookie: owner.headers.cookie,
      params: { id: from.id },
      body: { toEntryId: to.id, relation: 'sort of near' },
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/kind of link/);
  });

  it('will not link to an entry the actor cannot see', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    const mine = await create(owner, {
      name: 'Mine',
      location: { typeId: LAKE },
    });
    const theirs = await create(stranger, {
      name: 'Private to them',
      location: { typeId: CAR_PARK },
    });

    const { status } = await call(ADD_LINK, {
      path: `/api/places/${mine.id}/links`,
      method: 'POST',
      cookie: owner.headers.cookie,
      params: { id: mine.id },
      body: { toEntryId: theirs.id, relation: 'near' },
    });

    // Accepting would confirm that the far entry exists.
    expect(status).toBe(404);
  });
});
