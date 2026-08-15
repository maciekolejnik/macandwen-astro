import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | undefined;

/**
 * Bindings from `cloudflare:workers` are only readable inside a request, so the
 * client is built lazily on first use and then cached for the isolate — the
 * same shape as `getAuth()`.
 */
export function getDb(): Db {
  instance ??= drizzle(env.DB, { schema });
  return instance;
}
