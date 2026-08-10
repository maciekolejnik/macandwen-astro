/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Extra binding supplied by vitest.config.ts so setup.ts can migrate the
// test database.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
