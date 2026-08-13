import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Applied to the test database in test/setup.ts.
const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        // Keep in sync with wrangler.jsonc.
        compatibilityDate: '2026-06-27',
        compatibilityFlags: ['global_fetch_strictly_public', 'nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Stand-ins for the vars and secrets the Worker is given in production.
          BETTER_AUTH_URL: 'http://localhost:4321',
          BETTER_AUTH_SECRET: 'test-secret-value-at-least-32-characters',
          GOOGLE_CLIENT_ID: 'test-google-client-id',
          GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
