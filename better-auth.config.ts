import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { authOptions } from './src/lib/auth-options';

/**
 * For `@better-auth/cli generate` only, never bundled into the app.
 *
 * The CLI needs an exported `auth` instance, but `src/lib/auth.ts` exports a
 * lazy `getAuth()` that reads bindings from `cloudflare:workers`, which cannot
 * run outside a Worker. This builds an instance from the same options with a
 * dummy database, since only the options shape the generated schema. The
 * placeholder values are never used to talk to anything.
 */
export const auth = betterAuth({
  ...authOptions({
    BETTER_AUTH_URL: 'http://localhost:4321',
    BETTER_AUTH_SECRET: 'generate-only-placeholder-not-a-real-secret',
    GOOGLE_CLIENT_ID: 'generate-only',
    GOOGLE_CLIENT_SECRET: 'generate-only',
  }),
  database: drizzleAdapter({} as never, { provider: 'sqlite' }),
});
