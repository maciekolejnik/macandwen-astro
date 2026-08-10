# Authentication

Google is the only way to sign in. There are no passwords, so the app never
stores or resets credentials. Library: [better-auth](https://www.better-auth.com).

## Files

| Path | Role |
| --- | --- |
| `src/lib/auth.ts` | Server auth instance and its options |
| `src/lib/auth-client.ts` | Browser client (`signIn`, `signOut`, `getSession`) |
| `src/pages/api/auth/[...all].ts` | Catch-all route; better-auth owns every `/api/auth/*` endpoint |
| `src/middleware.ts` | Sets `Astro.locals.user` and `Astro.locals.session` |
| `src/components/AuthNav.astro` | Header entry: "Sign in" or the user's name |
| `src/pages/login.astro`, `src/pages/account.astro` | Sign-in and account screens |

## How a request sees the user

Middleware resolves the session once per request and exposes it:

```ts
const user = Astro.locals.user; // null when signed out
```

Any page reading this must opt out of prerendering, because a prerendered page
is built once and has no request to read cookies from:

```ts
export const prerender = false;
```

Blog pages stay prerendered for speed. That is why the header uses
`AuthNav.astro`, which fetches the session from the browser instead — a static
page cannot know who is visiting at build time.

## Two constraints worth knowing

**Bindings come from `cloudflare:workers`.** `Astro.locals.runtime.env` was
removed in Astro v6 and throws a descriptive error if used. Most better-auth
tutorials still show the old pattern.

```ts
import { env } from 'cloudflare:workers';
```

**The auth instance is built lazily.** Bindings are only readable inside a
request, so `getAuth()` constructs the instance on first call and caches it for
the isolate. Do not move that call to module scope.

## Roles

`user.role` is `"user"` by default and is `input: false`, so it can never be set
through the API — only by a direct database update:

```sh
npx wrangler d1 execute macandwen --remote \
  --command "UPDATE user SET role='admin' WHERE email='you@example.com'"
```

Admin-owned records are the public defaults shown to signed-out visitors.

## Configuration

Set in `.dev.vars` locally (see `.dev.vars.example`) and as Wrangler secrets in
production; `BETTER_AUTH_URL` is a plain var in `wrangler.jsonc`.

| Name | Notes |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Site origin. Wrong value breaks OAuth redirects. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console credentials |

```sh
npx wrangler secret put BETTER_AUTH_SECRET   # repeat per secret
```

Register both redirect URIs on the Google OAuth client:

```
http://localhost:4321/api/auth/callback/google
https://<your-domain>/api/auth/callback/google
```

## Adding another provider

Add it under `socialProviders` in `src/lib/auth.ts`, add its credentials, and
register the matching `/api/auth/callback/<provider>` URI. No schema change is
needed — the `account` table already links several providers to one user.
