import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import type { APIContext, MiddlewareNext } from 'astro';
import { onRequest } from '../src/middleware';
import { getAuth } from '../src/lib/auth';
import { signedInUser } from './helpers';

const BASE_URL = 'http://localhost:4321';

/**
 * Astro builds the real context from a routed request, which needs the dev
 * server, so this assembles only the parts `src/middleware.ts` reads: `url`,
 * `request.headers` and `locals`. Hence the cast — the rest of `APIContext` is
 * never touched. Everything downstream of it — the cookie's HMAC, the session
 * lookup, D1 — is real.
 */
async function runMiddleware(
  { cookie, pathname = '/account' }: { cookie?: string; pathname?: string } = {},
) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);

  const url = new URL(pathname, BASE_URL);
  const context = {
    url,
    request: new Request(url, { headers }),
    locals: {} as App.Locals,
  };

  let nextCalled = false;
  const next: MiddlewareNext = async () => {
    nextCalled = true;
    return new Response('rendered');
  };

  const response = await onRequest(context as unknown as APIContext, next);

  return { locals: context.locals, response: response as Response, nextCalled };
}

async function sessionCookieName() {
  return (await getAuth().$context).authCookies.sessionToken.name;
}

describe('session resolution', () => {
  it('leaves locals signed out for an anonymous request', async () => {
    const { locals, response, nextCalled } = await runMiddleware();

    expect(locals.user).toBeNull();
    expect(locals.session).toBeNull();
    expect(nextCalled).toBe(true);
    expect(await response.text()).toBe('rendered');
  });

  it('populates locals for a valid session', async () => {
    const user = await signedInUser();

    const { locals } = await runMiddleware({ cookie: user.headers.cookie });

    expect(locals.user?.id).toBe(user.id);
    expect(locals.user?.email).toBe(user.email);
    expect(locals.session?.userId).toBe(user.id);
  });

  it('leaves locals signed out for an expired session', async () => {
    const user = await signedInUser();
    await env.DB.prepare('UPDATE session SET expires_at = ? WHERE user_id = ?')
      .bind(Date.now() - 1000, user.id)
      .run();

    const { locals } = await runMiddleware({ cookie: user.headers.cookie });

    expect(locals.user).toBeNull();
    expect(locals.session).toBeNull();
  });
});

/**
 * A cookie is attacker-supplied and sticky: the browser resends it on every
 * request, so anything that fails here fails repeatedly for that visitor.
 *
 * These pass against better-auth today and exist to catch a regression on
 * upgrade. Two cases cover the distinct paths — a well-formed cookie that fails
 * the signature check, and one malformed enough to break decoding before any
 * check happens — so more variants would only re-test the same library code.
 */
describe('malformed session cookies', () => {
  const shapes: Record<string, (name: string) => string> = {
    'wrong signature': name => `${name}=abc.notavalidsignature`,
    'invalid percent-encoding': name => `${name}=%E0%A4%A`,
  };

  for (const [label, build] of Object.entries(shapes)) {
    it(`treats a cookie with ${label} as signed out`, async () => {
      const cookie = build(await sessionCookieName());

      const { locals, nextCalled } = await runMiddleware({ cookie });

      expect(locals.user).toBeNull();
      expect(locals.session).toBeNull();
      expect(nextCalled).toBe(true);
    });
  }

  it('ignores a token that is signed correctly but has no session row', async () => {
    const user = await signedInUser();
    await env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(user.id).run();

    const { locals } = await runMiddleware({ cookie: user.headers.cookie });

    expect(locals.user).toBeNull();
  });
});

describe('auth endpoints', () => {
  /**
   * better-auth's handler resolves the session itself, so the middleware skips
   * the lookup to save a D1 query. A valid cookie still arriving as signed-out
   * locals is the observable proof that the lookup was skipped.
   */
  it('does not resolve a session for /api/auth/ requests', async () => {
    const user = await signedInUser();

    const { locals, nextCalled } = await runMiddleware({
      cookie: user.headers.cookie,
      pathname: '/api/auth/get-session',
    });

    expect(locals.user).toBeNull();
    expect(locals.session).toBeNull();
    expect(nextCalled).toBe(true);
  });

  it('still resolves a session for paths merely starting with /api', async () => {
    const user = await signedInUser();

    const { locals } = await runMiddleware({
      cookie: user.headers.cookie,
      pathname: '/api/authors',
    });

    expect(locals.user?.id).toBe(user.id);
  });
});

/**
 * Unlike the cases above, a transient D1 failure has no unmocked equivalent —
 * dropping the table fakes one by corrupting the schema, which is a different
 * fault and leaves the database broken for later tests. This stubs the binding
 * instead, which is honest about being a simulation and reaches the same
 * unguarded call.
 */
describe('when the session lookup fails', () => {
  // `env.DB` is shared across the file, so the stub has to come back off.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('degrades to signed out rather than failing the request', async () => {
    const user = await signedInUser();
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('D1_ERROR: network connection lost');
    });

    const { locals, response, nextCalled } = await runMiddleware({
      cookie: user.headers.cookie,
    });

    expect(locals.user).toBeNull();
    expect(locals.session).toBeNull();
    expect(nextCalled).toBe(true);
    expect(await response.text()).toBe('rendered');
  });
});
