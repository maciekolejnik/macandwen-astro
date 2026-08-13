import { defineMiddleware } from 'astro:middleware';
import { getAuth } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.session = null;

  // The auth handler resolves its own session, so skip the extra lookup.
  if (context.url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  const result = await getAuth().api.getSession({ headers: context.request.headers });

  context.locals.user = result?.user ?? null;
  context.locals.session = result?.session ?? null;

  return next();
});
