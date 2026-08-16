import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Applied to the test database in test/setup.ts.
const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  test: {
    // Two environments, because they cannot be one. Nearly everything runs in
    // workerd against a real D1, but the filter wiring is browser code and
    // workerd has no DOM, so those tests get happy-dom instead.
    projects: [
      {
        resolve: {
          alias: {
            // `astro:middleware` is a virtual module supplied by Astro's Vite
            // plugin, which does not run under the workers pool. See the shim
            // for why this is faithful to Astro's own implementation.
            'astro:middleware': path.join(import.meta.dirname, 'test/astro-middleware.ts'),
          },
        },
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
          name: 'workers',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.dom.test.ts'],
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          include: ['test/**/*.dom.test.ts'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
