import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Order matters: sessions and accounts reference users.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM session'),
    env.DB.prepare('DELETE FROM account'),
    env.DB.prepare('DELETE FROM verification'),
    env.DB.prepare('DELETE FROM user'),
  ]);
});
