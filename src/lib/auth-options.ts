import type { BetterAuthOptions } from 'better-auth';

export interface AuthEnv {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/**
 * Everything except the database, which differs between the two callers: the
 * running app binds D1, while the better-auth CLI binds a dummy adapter to
 * generate the schema. Keeping the options here means the CLI reads the real
 * configuration, so a regenerated schema always matches what the app expects.
 *
 * Must not import `cloudflare:workers` - the CLI runs outside a Worker.
 */
export function authOptions(env: AuthEnv) {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
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
  } satisfies BetterAuthOptions;
}
