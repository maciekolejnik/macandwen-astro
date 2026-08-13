# Authentication

Google is the only way to sign in. There are no passwords, so the app never
stores or resets credentials. Library: [better-auth](https://www.better-auth.com).

## Files

| Path | Role |
| --- | --- |
| `src/lib/auth.ts` | Server auth instance: options plus the D1 database |
| `src/lib/auth-client.ts` | Browser client (`signIn`, `signOut`, `getSession`) |
| `src/pages/api/auth/[...all].ts` | Catch-all route; better-auth owns every `/api/auth/*` endpoint |
| `src/middleware.ts` | Sets `Astro.locals.user` and `Astro.locals.session` |
| `src/components/AuthNav.astro` | Header entry: "Sign in" or the user's name |
| `src/pages/login.astro`, `src/pages/account.astro` | Sign-in and account screens |

## What signing in writes to the database

The schema is in `docs/features/database.md`; this is how the four tables are
used for one person.

Signing in is an OAuth round trip. better-auth generates a random `state` and
PKCE verifier, stores them in **`verification`**, and redirects to Google.
Google comes back to `/api/auth/callback/google`, and the state row is looked
up, deleted, and rejected if missing or expired — that is the CSRF defence.
The code is then exchanged for tokens and the profile is read from the
`id_token`.

| Table | Written when | Lifetime |
| --- | --- | --- |
| `user` | First sign-in only | Permanent |
| `account` | First sign-in, then updated on every later one | Permanent |
| `session` | Every sign-in | Until expiry or sign-out |
| `verification` | Start of each sign-in, deleted at the callback | Seconds |

**`user`** is created once. `email` is uniquely indexed, so a later sign-in
matches the existing row instead of duplicating it, and the person keeps the
same `user.id` forever.

**`account`** holds the link to the Google identity, keyed by
`provider_id='google'` plus `account_id` (Google's `sub`). Later sign-ins update
the same row with fresh tokens rather than adding rows. A second provider would
add a second row against the same `user_id`.

**`session`** gets a new row per sign-in: a random `token` behind a unique
index, `expires_at` 30 days out, and the `ip_address` / `user_agent` that
created it. The cookie carries only the signed token, never user data.

**`verification`** holds nothing but in-flight OAuth state. It is not linked to
a user, because it is keyed by state before anyone is identified.

Sessions are removed on sign-out, and expired ones are cleaned up lazily: a
request presenting an expired token has the row deleted as a side effect of the
lookup. Nothing sweeps the table on a timer, so sessions of users who simply
stop visiting stay until they return. That is fine at this scale, but it is why
larger deployments add a cleanup job.

Deleting a user cascades to their `account` and `session` rows.

## Staying signed in

`session.expiresIn` is 30 days and `updateAge` is 1 day, so a session read more
than a day after its last write has `expires_at` pushed out again. The window
rolls forward and active readers are never logged out; someone away for a month
signs in again.

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
page cannot know who is visiting at build time. It renders the signed-out
"Sign in" link by default and only upgrades it once a session comes back, so
the link still works if the script never runs; `/login` redirects an already
signed-in visitor on to `/account`.

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

It is declared as an additional field in `src/lib/auth.ts` rather than added to
the schema by hand. Admin-owned records are the public defaults shown to
signed-out visitors.

## Configuration

Set in `.dev.vars` locally (see `.dev.vars.example`) and as Wrangler secrets in
production; `BETTER_AUTH_URL` is a plain var in `wrangler.jsonc`, which
`.dev.vars` overrides locally so sign-in points at `localhost`.

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

## Tests

`test/auth.test.ts` runs against real D1 in workerd (`npm test`). It covers
session handling, the Google authorize URL, that password sign-in stays off, and
that a user cannot set their own `role`.

Google's actual token exchange is not tested — that would test Google and
better-auth, and needs real credentials. So `test/helpers.ts` seeds a user and a
session row directly, signing the cookie the way better-auth does, since the
library rejects unsigned session cookies.

The two role tests work as a pair: one asserts setting `role` is refused, the
other asserts an ordinary field still updates. Without the second, the first
would pass even if the endpoint broke entirely.

## Adding another provider

Add it under `socialProviders` in `src/lib/auth.ts`, add its credentials, and
register the matching `/api/auth/callback/<provider>` URI. No schema change is
normally needed — the `account` table already links several providers to one
user — and `test/schema.test.ts` will tell you if one does add a column.
