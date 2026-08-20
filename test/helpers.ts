import { env } from 'cloudflare:workers';
import { getAuth } from '../src/lib/auth';

export const BASE_URL = 'http://localhost:4321';

/**
 * better-auth stores the session token as `<token>.<hmac>`, so a hand-written
 * cookie is rejected. This mirrors that signing rather than importing the
 * library's internals, which are not exported.
 */
async function signedSessionCookie(token: string) {
  const context = await getAuth().$context;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(context.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(token),
  );
  const value = encodeURIComponent(
    `${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`,
  );

  return `${context.authCookies.sessionToken.name}=${value}`;
}

/**
 * Seeds a user and a valid session directly, since a real Google sign-in
 * cannot run in tests. Returns the cookie header that authenticates them.
 */
export async function signedInUser(
  overrides: { email?: string; role?: string } = {},
) {
  const id = crypto.randomUUID();
  const email = overrides.email ?? `${id}@example.com`;
  const role = overrides.role ?? 'user';
  const token = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
  )
    .bind(id, 'Test User', email, role, now, now)
    .run();

  await env.DB.prepare(
    `INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), token, id, now + 60 * 60 * 1000, now, now)
    .run();

  return {
    id,
    email,
    role,
    headers: { cookie: await signedSessionCookie(token) },
  };
}

export async function readUser(id: string) {
  return env.DB.prepare('SELECT id, email, role, name FROM user WHERE id = ?')
    .bind(id)
    .first<{ id: string; email: string; role: string; name: string }>();
}

/**
 * Item inputs from plain texts. Most tests care about an item's text and not
 * the options it belongs to, and this keeps them saying so.
 */
export function texts(...values: string[]) {
  return values.map((text) => ({ text }));
}
