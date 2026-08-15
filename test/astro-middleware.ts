/**
 * Stands in for the `astro:middleware` virtual module, which is supplied by
 * Astro's Vite plugin and so is unavailable under the workers pool. Aliased in
 * `vitest.config.ts`.
 *
 * Astro's own `defineMiddleware` is the identity function — it exists purely to
 * type the callback (see `astro/dist/core/middleware/defineMiddleware.js`) — so
 * this changes no behaviour. Importing the real `astro/middleware` barrel
 * instead pulls in `es-module-lexer`, which needs Wasm that workerd disallows.
 */
export function defineMiddleware<T>(fn: T): T {
  return fn;
}
