import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema';

function createAuth() {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: false,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          // Never settable from the client - only via a direct DB update.
          input: false,
          // Emits `notNull()`; safe because defaultValue is applied first.
          required: true,
        },
      },
      // Lets people erase their own account, which cascades to their `account`
      // and `session` rows. Without a password to re-check, better-auth instead
      // requires a session younger than `session.freshAge`, so a long-signed-in
      // visitor is asked to sign in again first.
      deleteUser: {
        enabled: true,
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
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
