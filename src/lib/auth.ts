import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema';
import { authOptions } from './auth-options';

function createAuth() {
  return betterAuth({
    ...authOptions(env),
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: 'sqlite',
      schema,
    }),
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * Bindings from `cloudflare:workers` are only readable inside a request, so the
 * instance is built lazily on first use and then cached for the isolate.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
