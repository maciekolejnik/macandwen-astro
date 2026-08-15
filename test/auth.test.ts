import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { getAuth } from '../src/lib/auth';
import { BASE_URL, readUser, signedInUser } from './helpers';

function request(path: string, init: RequestInit = {}) {
  return getAuth().handler(new Request(`${BASE_URL}/api/auth${path}`, init));
}

describe('sessions', () => {
  it('returns no session for an anonymous request', async () => {
    const response = await request('/get-session');

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it('returns the signed-in user', async () => {
    const user = await signedInUser({ email: 'mac@example.com' });

    const response = await request('/get-session', { headers: user.headers });
    const body = await response.json<any>();

    expect(body?.user?.email).toBe('mac@example.com');
  });

  it('ignores an expired session', async () => {
    const user = await signedInUser();
    await env.DB.prepare('UPDATE session SET expires_at = ? WHERE user_id = ?')
      .bind(Date.now() - 1000, user.id)
      .run();

    const response = await request('/get-session', { headers: user.headers });

    expect(await response.json()).toBeNull();
  });

  it('ignores a forged session token', async () => {
    await signedInUser();

    const response = await request('/get-session', {
      headers: { cookie: 'better-auth.session_token=not-a-real-token' },
    });

    expect(await response.json()).toBeNull();
  });
});

describe('google sign-in', () => {
  it('redirects to Google with PKCE and our callback', async () => {
    const response = await request('/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/account' }),
    });

    expect(response.status).toBe(200);
    const { url } = await response.json<{ url: string }>();
    const authorize = new URL(url);

    expect(authorize.origin).toBe('https://accounts.google.com');
    expect(authorize.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      `${BASE_URL}/api/auth/callback/google`,
    );
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('state')).toBeTruthy();
  });

  it('rejects providers we have not configured', async () => {
    const response = await request('/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/account' }),
    });

    expect(response.ok).toBe(false);
  });
});

/**
 * `/login` reads `redirectTo` from the query string and hands it to
 * `signIn.social` as `callbackURL`, so an attacker-chosen value reaches the
 * post-sign-in redirect — the shape of an open redirect, which is worth phishing
 * because the link the victim clicks is genuinely ours.
 *
 * better-auth already refuses these, validating against `trustedOrigins`, which
 * defaults to `baseURL` even though we never set it. So these guard two things
 * that would silently reopen it: widening `trustedOrigins` or setting
 * `disableOriginCheck` in `src/lib/auth.ts` (the absolute case catches either),
 * and better-auth's own handling of a path that only looks relative.
 */
describe('post-sign-in redirect targets', () => {
  async function signInWith(callbackURL: string) {
    return request('/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ provider: 'google', callbackURL }),
    });
  }

  async function expectRefused(callbackURL: string) {
    const response = await signInWith(callbackURL);

    expect(response.status).toBe(403);
    const { code } = await response.json<{ code: string }>();
    expect(code).toBe('INVALID_CALLBACK_URL');
  }

  it('refuses an off-site callbackURL', async () => {
    await expectRefused('https://evil.com');
  });

  // Protocol-relative: a browser reads this as off-site, so a check that only
  // asks whether it starts with `/` would let it through.
  it('refuses a callbackURL that only looks relative', async () => {
    await expectRefused('//evil.com');
  });

  it('allows a relative path on our own site', async () => {
    const response = await signInWith('/account?from=test');

    expect(response.status).toBe(200);
  });
});

describe('password sign-in is disabled', () => {
  it('refuses email and password sign-up', async () => {
    const response = await request('/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'someone@example.com',
        password: 'a-long-enough-password',
        name: 'Someone',
      }),
    });

    expect(response.ok).toBe(false);
  });
});

describe('role escalation', () => {
  it('rejects an attempt to set your own role', async () => {
    const user = await signedInUser();

    const response = await request('/update-user', {
      method: 'POST',
      headers: {
        ...user.headers,
        'content-type': 'application/json',
        origin: BASE_URL,
      },
      body: JSON.stringify({ name: 'Renamed', role: 'admin' }),
    });

    expect(response.ok).toBe(false);
    expect((await readUser(user.id))?.role).toBe('user');
  });

  // Guards the test above: if the endpoint stopped working entirely, that test
  // would still pass while proving nothing.
  it('allows updating an ordinary field', async () => {
    const user = await signedInUser();

    const response = await request('/update-user', {
      method: 'POST',
      headers: {
        ...user.headers,
        'content-type': 'application/json',
        origin: BASE_URL,
      },
      body: JSON.stringify({ name: 'Renamed' }),
    });

    expect(response.ok).toBe(true);
    expect((await readUser(user.id))?.name).toBe('Renamed');
  });

  it('reports the role assigned in the database', async () => {
    const admin = await signedInUser({ role: 'admin' });

    const response = await request('/get-session', { headers: admin.headers });
    const body = await response.json<any>();

    expect(body?.user?.role).toBe('admin');
  });
});
