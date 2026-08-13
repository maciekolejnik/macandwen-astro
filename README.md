# Mac & Wen

Travel and outdoor blog at [macandwen.com](https://macandwen.com) — hiking,
climbing, cycling and trips.

## Stack

| | |
| --- | --- |
| [Astro](https://docs.astro.build) | Site framework. Blog posts are markdown in `src/content/blog/`, rendered as static pages. |
| [Tailwind CSS](https://tailwindcss.com) | Styling, via the Vite plugin |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/) | Hosting, through `@astrojs/cloudflare` |
| [Cloudflare D1](https://developers.cloudflare.com/d1/) + [Drizzle](https://orm.drizzle.team) | SQLite database and typed queries |
| [better-auth](https://www.better-auth.com) | Sign-in with Google |
| [Vitest](https://vitest.dev) | Tests, run inside the Workers runtime |

Pages are prerendered at build time unless they need a signed-in user, which
keeps the blog fast. Details in `docs/features/`.

## Running locally

Requires Node 26 (see `.nvmrc`).

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in the values below
npm run db:migrate:local         # create the local database
npm run dev                      # http://localhost:4321
```

`.dev.vars` holds local secrets and is never committed:

- `BETTER_AUTH_SECRET` — any random string, `openssl rand -base64 32`
- `BETTER_AUTH_URL` — `http://localhost:4321`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from a Google Cloud OAuth
  client, with `http://localhost:4321/api/auth/callback/google` registered as a
  redirect URI

Everything runs on your machine: the dev server uses the real Cloudflare runtime
locally, and the database is a local SQLite file under `.wrangler/`. Nothing
touches production. The blog itself works without any of the auth setup — you
only need the Google credentials to sign in.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Dev server on `localhost:4321` |
| `npm test` | Run tests |
| `npm run astro check` | Type check |
| `npm run build` | Production build to `./dist/` |
| `npm run preview` | Serve the build locally |
| `npm run db:generate` | Write a migration after changing the schema |
| `npm run db:migrate:local` | Apply migrations to the local database |
| `npm run db:migrate:remote` | Apply migrations to production (CI does this on merge) |

CI runs type check, tests and build on every pull request. On merge to `main`,
it also applies any new migrations to the production database. Deploys are
handled separately by Cloudflare's Git integration, so a migration must be
backwards compatible with the currently deployed code — add columns and tables,
and leave removals until after the code that used them is gone.

## Writing a post

Add a markdown file to `src/content/blog/`. The filename becomes the URL, and
the frontmatter fields are defined in `src/content.config.ts`.

## Contributing

Each feature gets its own git worktree so parallel work never shares a checkout
— see `AGENTS.md`, which is also the brief for AI coding agents.
