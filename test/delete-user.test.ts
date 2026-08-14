import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { getAuth } from '../src/lib/auth';
import { BASE_URL, readUser, signedInUser } from './helpers';

function request(path: string, init: RequestInit = {}) {
  return getAuth().handler(new Request(`${BASE_URL}/api/auth${path}`, init));
}

function deleteAccount(user: { headers: { cookie: string } }) {
  return request('/delete-user', {
    method: 'POST',
    headers: {
      ...user.headers,
      'content-type': 'application/json',
      origin: BASE_URL,
    },
    body: JSON.stringify({ callbackURL: '/' }),
  });
}

async function countRows(table: 'session' | 'account', userId: string) {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

describe('account deletion', () => {
  it('erases the user and everything linked to them', async () => {
    const user = await signedInUser();
    await env.DB.prepare(
      `INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at)
       VALUES (?, ?, 'google', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), 'google-123', user.id, Date.now(), Date.now())
      .run();

    const response = await deleteAccount(user);

    expect(response.ok).toBe(true);
    expect(await readUser(user.id)).toBeNull();
    // Tokens and sessions must not outlive the account they belong to.
    expect(await countRows('account', user.id)).toBe(0);
    expect(await countRows('session', user.id)).toBe(0);
  });

  it('refuses when the session is no longer fresh', async () => {
    const user = await signedInUser();
    // Older than the default freshAge of one day.
    await env.DB.prepare('UPDATE session SET created_at = ? WHERE user_id = ?')
      .bind(Date.now() - 2 * 24 * 60 * 60 * 1000, user.id)
      .run();

    const response = await deleteAccount(user);

    // The account page relies on this status to tell the user to sign in again.
    expect(response.status).toBe(400);
    expect(await readUser(user.id)).not.toBeNull();
  });

  it('refuses an anonymous request', async () => {
    const user = await signedInUser();

    const response = await request('/delete-user', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL },
      body: JSON.stringify({ callbackURL: '/' }),
    });

    expect(response.status).toBe(401);
    expect(await readUser(user.id)).not.toBeNull();
  });

  it('does not let one user delete another', async () => {
    const victim = await signedInUser({ email: 'victim@example.com' });
    const attacker = await signedInUser({ email: 'attacker@example.com' });

    const response = await request('/delete-user', {
      method: 'POST',
      headers: {
        ...attacker.headers,
        'content-type': 'application/json',
        origin: BASE_URL,
      },
      body: JSON.stringify({ callbackURL: '/', userId: victim.id }),
    });

    expect(await readUser(victim.id)).not.toBeNull();
    if (response.ok) {
      // Deleting is allowed, but only ever the caller's own account.
      expect(await readUser(attacker.id)).toBeNull();
    }
  });
});
