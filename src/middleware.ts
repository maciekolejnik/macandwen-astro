import { defineMiddleware } from 'astro:middleware';
import { getAuth } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;
  context.locals.session = null;

  // The auth handler resolves its own session, so skip the extra lookup.
  if (context.url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  try {
    const result = await getAuth().api.getSession({ headers: context.request.headers });

    context.locals.user = result?.user ?? null;
    context.locals.session = result?.session ?? null;
  } catch (error) {
    // Runs on every non-prerendered request, so an uncaught failure here would
    // be a 500 even on pages that never read the session. Signed out is the
    // safe answer when the session cannot be resolved.
    console.error('Failed to resolve session', error);
  }

  return next();
});
