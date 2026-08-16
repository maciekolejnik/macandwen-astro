import { describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { onRequest } from '../src/middleware';
import { POST } from '../src/pages/api/packing-lists/index';
import { DELETE, PATCH } from '../src/pages/api/packing-lists/[id]';
import {
  POST as SAVE,
  DELETE as UNSAVE,
} from '../src/pages/api/packing-lists/[id]/save';
import { create, getById } from '../src/lib/db/packing-lists';
import { BASE_URL, signedInUser } from './helpers';

type Handler = (context: APIContext) => Promise<Response> | Response;

/**
 * Astro builds the real context from a routed request, which needs the dev
 * server. This assembles what the routes read — `request`, `params`, `locals` —
 * and fills `locals` by running the actual middleware over the actual cookie,
 * so authentication is exercised rather than assumed.
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

const PATH = '/api/packing-lists';

describe('POST /api/packing-lists', () => {
  it('creates a list for a signed-in user', async () => {
    const user = await signedInUser();

    const { status, body } = await call(POST, {
      path: PATH,
      method: 'POST',
      cookie: user.headers.cookie,
      body: { title: 'Ski trip', isPublic: true, items: ['Skis', 'Gloves'] },
    });

    expect(status).toBe(201);

    const list = await getById(body.id as string, user.id);
    expect(list?.title).toBe('Ski trip');
    expect(list?.isPublic).toBe(true);
    expect(list?.items.map((item) => item.text)).toEqual(['Skis', 'Gloves']);
  });

  it('rejects an anonymous request', async () => {
    const { status, body } = await call(POST, {
      path: PATH,
      method: 'POST',
      body: { title: 'Ski trip', isPublic: true, items: [] },
    });

    expect(status).toBe(401);
    expect(body.error).toBeTypeOf('string');
  });

  it('rejects a body that is not a JSON object', async () => {
    const user = await signedInUser();

    for (const body of ['not json', '[]', '"a string"']) {
      const result = await call(POST, {
        path: PATH,
        method: 'POST',
        cookie: user.headers.cookie,
        body,
      });

      expect(result.status).toBe(400);
    }
  });

  it('rejects a body sent without a JSON content type', async () => {
    const user = await signedInUser();

    const url = new URL(PATH, BASE_URL);
    const context = {
      url,
      request: new Request(url, {
        method: 'POST',
        headers: {
          cookie: user.headers.cookie,
          // A cross-origin POST can send this without a preflight.
          'content-type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify({ title: 'Sneaky', isPublic: true, items: [] }),
      }),
      params: {},
      locals: {} as App.Locals,
    };

    await onRequest(context as unknown as APIContext, async () =>
      Response.json(null),
    );
    const response = await POST(context as unknown as APIContext);

    expect(response.status).toBe(400);
  });

  it('rejects fields of the wrong type', async () => {
    const user = await signedInUser();
    const valid = { title: 'Trip', isPublic: false, items: ['Boots'] };

    const bodies = [
      { ...valid, title: 42 },
      { ...valid, isPublic: 'yes' },
      { ...valid, items: 'Boots' },
      { ...valid, items: ['Boots', 7] },
      { isPublic: false, items: [] },
    ];

    for (const body of bodies) {
      const result = await call(POST, {
        path: PATH,
        method: 'POST',
        cookie: user.headers.cookie,
        body,
      });

      expect(result.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers 400, not 500, when the content rules reject the input', async () => {
    const user = await signedInUser();

    const { status, body } = await call(POST, {
      path: PATH,
      method: 'POST',
      cookie: user.headers.cookie,
      body: { title: '   ', isPublic: false, items: [] },
    });

    expect(status).toBe(400);
    expect(body.error).toBe('A packing list needs a title');
  });
});

describe('PATCH /api/packing-lists/[id]', () => {
  it('updates a list the user owns', async () => {
    const user = await signedInUser();
    const id = await create(user.id, {
      title: 'Draft',
      isPublic: false,
      items: ['Old'],
    });

    const { status } = await call(PATCH, {
      path: `${PATH}/${id}`,
      method: 'PATCH',
      cookie: user.headers.cookie,
      params: { id },
      body: { title: 'Final', isPublic: true, items: ['New'] },
    });

    expect(status).toBe(200);

    const list = await getById(id);
    expect(list?.title).toBe('Final');
    expect(list?.isPublic).toBe(true);
    expect(list?.items.map((item) => item.text)).toEqual(['New']);
  });

  it('rejects an anonymous request', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Draft',
      isPublic: true,
      items: [],
    });

    const { status } = await call(PATCH, {
      path: `${PATH}/${id}`,
      method: 'PATCH',
      params: { id },
      body: { title: 'Hijacked', isPublic: true, items: [] },
    });

    expect(status).toBe(401);
    expect((await getById(id))?.title).toBe('Draft');
  });

  it('answers 404 for another user\u2019s list, exactly as for a missing one', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    const id = await create(owner.id, {
      title: 'Mine',
      isPublic: true,
      items: [],
    });

    const payload = { title: 'Stolen', isPublic: false, items: [] };
    const theirs = await call(PATCH, {
      path: `${PATH}/${id}`,
      method: 'PATCH',
      cookie: stranger.headers.cookie,
      params: { id },
      body: payload,
    });
    const missing = await call(PATCH, {
      path: `${PATH}/${crypto.randomUUID()}`,
      method: 'PATCH',
      cookie: stranger.headers.cookie,
      params: { id: crypto.randomUUID() },
      body: payload,
    });

    expect(theirs.status).toBe(404);
    expect(theirs).toEqual(missing);
    expect((await getById(id))?.title).toBe('Mine');
  });
});

describe('DELETE /api/packing-lists/[id]', () => {
  it('deletes a list the user owns', async () => {
    const user = await signedInUser();
    const id = await create(user.id, {
      title: 'Temporary',
      isPublic: false,
      items: ['Thing'],
    });

    const { status } = await call(DELETE, {
      path: `${PATH}/${id}`,
      method: 'DELETE',
      cookie: user.headers.cookie,
      params: { id },
    });

    expect(status).toBe(200);
    expect(await getById(id, user.id)).toBeNull();
  });

  it('rejects an anonymous request', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Keep',
      isPublic: true,
      items: [],
    });

    const { status } = await call(DELETE, {
      path: `${PATH}/${id}`,
      method: 'DELETE',
      params: { id },
    });

    expect(status).toBe(401);
    expect(await getById(id)).not.toBeNull();
  });

  it('answers 404 for another user\u2019s list, exactly as for a missing one', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    const id = await create(owner.id, {
      title: 'Mine',
      isPublic: true,
      items: [],
    });

    const theirs = await call(DELETE, {
      path: `${PATH}/${id}`,
      method: 'DELETE',
      cookie: stranger.headers.cookie,
      params: { id },
    });
    const missing = await call(DELETE, {
      path: `${PATH}/${crypto.randomUUID()}`,
      method: 'DELETE',
      cookie: stranger.headers.cookie,
      params: { id: crypto.randomUUID() },
    });

    expect(theirs.status).toBe(404);
    expect(theirs).toEqual(missing);
    expect(await getById(id)).not.toBeNull();
  });
});

describe('POST/DELETE /api/packing-lists/[id]/save', () => {
  const savePath = (id: string) => `${PATH}/${id}/save`;

  it('saves and unsaves a public list, reporting the count', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Sailing',
      isPublic: true,
      items: [],
    });

    const saved = await call(SAVE, {
      path: savePath(id),
      method: 'POST',
      cookie: fan.headers.cookie,
      params: { id },
    });

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ saved: true, count: 1 });

    const unsaved = await call(UNSAVE, {
      path: savePath(id),
      method: 'DELETE',
      cookie: fan.headers.cookie,
      params: { id },
    });

    expect(unsaved.status).toBe(200);
    expect(unsaved.body).toEqual({ saved: false, count: 0 });
  });

  it('is idempotent, so a double click cannot double count', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Sailing',
      isPublic: true,
      items: [],
    });

    await call(SAVE, {
      path: savePath(id),
      method: 'POST',
      cookie: fan.headers.cookie,
      params: { id },
    });
    const again = await call(SAVE, {
      path: savePath(id),
      method: 'POST',
      cookie: fan.headers.cookie,
      params: { id },
    });

    expect(again.body).toEqual({ saved: true, count: 1 });
  });

  it('rejects an anonymous request', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Sailing',
      isPublic: true,
      items: [],
    });

    const { status } = await call(SAVE, {
      path: savePath(id),
      method: 'POST',
      params: { id },
    });

    expect(status).toBe(401);
  });

  it('answers 404 for a private, missing or own list alike', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const priv = await create(owner.id, {
      title: 'Private',
      isPublic: false,
      items: [],
    });
    const mine = await create(fan.id, {
      title: 'Mine',
      isPublic: true,
      items: [],
    });

    for (const id of [priv, mine, crypto.randomUUID()]) {
      const { status, body } = await call(SAVE, {
        path: savePath(id),
        method: 'POST',
        cookie: fan.headers.cookie,
        params: { id },
      });

      expect(status).toBe(404);
      expect(body.error).toBeTypeOf('string');
    }
  });
});
