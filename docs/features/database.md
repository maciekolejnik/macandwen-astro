# Database

Cloudflare D1 (SQLite) via [Drizzle ORM](https://orm.drizzle.team), bound as
`DB`. The site already runs on Cloudflare Workers, so D1 is a native binding:
no connection string, no network hop, and no extra service to pay for.

## Why D1

| Option | Verdict |
| --- | --- |
| **D1** | Chosen. Native binding, sub-millisecond reads, free tier far beyond this site's needs. |
| Turso | Also SQLite, but reached over HTTP — latency for no gain here. |
| Neon | Real Postgres with PostGIS. The fallback if geospatial queries are ever needed. |
| Supabase | Free tier pauses after a week of inactivity; unsuitable for a low-traffic site. |

**The known limit:** D1 is SQLite, so there is no PostGIS. A future locations
table should store `lat` / `lng` as `REAL` and filter by bounding box, which is
fine for thousands of points. Real radius or geometry queries would mean moving
to Neon, so avoid depending on SQLite-only behaviour in query code.

## Files

| Path | Role |
| --- | --- |
| `src/lib/db/schema.ts` | Drizzle schema — the single source of truth |
| `src/lib/auth-options.ts` | better-auth options, shared by the app and the CLI |
| `better-auth.config.ts` | Entry point for the schema generator |
| `scripts/schema.mjs` | Regenerates and checks the schema |
| `migrations/` | Generated SQL plus `meta/` state, applied by Wrangler |
| `drizzle.config.ts` | Points drizzle-kit at the schema and output |

## Changing the schema

Edit `src/lib/db/schema.ts`, then:

```sh
npm run db:generate       # write a SQL migration from the schema diff
npm run db:migrate:local  # apply to the local database
```

Commit the whole of `migrations/` — both the `.sql` files and `meta/`. The
`meta/` directory is how drizzle-kit knows the current schema state:
`_journal.json` indexes the migrations in order, and each `NNNN_snapshot.json`
describes the schema after that migration. `db:generate` diffs the schema
against the newest snapshot, so if `meta/` is missing or stale it assumes an
empty database and regenerates `CREATE TABLE` statements for tables that
already exist.

Migrations are ordinary SQL files under `migrations/`. Review the generated file
before applying it — SQLite cannot alter most columns in place, so drizzle-kit
rewrites whole tables to make some changes. Never edit a migration that has
already been applied; add a new one.

## The auth tables

`user`, `session`, `account` and `verification` are not written by hand. The
better-auth CLI generates them from the auth configuration, and they have to
keep matching what the library expects at runtime — it queries columns like
`session.token` and `account.provider_id` by name, so a mismatch is a request
failing in production rather than a type error.

Which columns are needed depends on the configuration, not just the library
version. Enabling a provider, turning on passwords or adding a plugin all
change the answer. So the options live in `src/lib/auth-options.ts`, shared by
two callers: `src/lib/auth.ts`, which adds the D1 database, and
`better-auth.config.ts`, which adds a dummy one for the CLI. The CLI needs an
exported `auth` instance and cannot run `src/lib/auth.ts` directly, because
that reads bindings from `cloudflare:workers`. Sharing the options means the
generated schema always reflects the real configuration instead of a copy that
quietly drifts.

To regenerate after changing the auth config or upgrading the library:

```sh
npm run db:schema:generate   # rewrite src/lib/db/schema.ts
npm run db:generate          # write a migration for any difference
```

`user.role` is included, because `auth-options.ts` declares it as an additional
field — nothing has to be reapplied by hand afterwards. Its `required: true`
is what produces `notNull()`; it cannot reject a sign-in, since better-auth
applies `defaultValue` before checking whether a field is required.

Regenerating is otherwise a no-op, and CI checks exactly that. `npm run
db:schema:check` regenerates into a temporary file and fails if it differs from
the committed schema, so a better-auth upgrade that expects a new column shows
up as a failed build with a diff. Without it, nothing re-runs the generator on
install and the first sign of trouble would be a 500 in production.

**What the check cannot tell you.** The CLI is published separately from the
library and lags it — `@better-auth/cli` was at 1.4.21 when `better-auth` was
at 1.6.26 — and it brings its own copy of the library, which is what defines
the tables it emits. So the check compares the schema against the version
pinned in `scripts/schema.mjs`, not against the version the app actually runs.
The two agree today, but a column introduced by a release newer than that pin
will not be detected until the pin moves.

Upgrading `better-auth` is therefore two steps, not one: bump the dependency,
then raise the pin to the matching CLI release once it exists and run
`npm run db:schema:generate`. A migration may fall out of it. Pinning is still
better than tracking latest, which would fail the build on unrelated CLI
releases, but it is the reason the pin should not be left to rot.

## Applying to production

CI applies migrations automatically. The `migrate` job in
`.github/workflows/ci.yml` runs `npm run db:migrate:remote` on every push to
`main`, after type check, tests and build have passed. It is skipped on pull
requests, and a concurrency group keeps two merges from migrating at once.
Wrangler detects CI and skips its confirmation prompt.

The job needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a custom token
with **Account → D1 → Edit**) and `CLOUDFLARE_ACCOUNT_ID`.

Applying a migration means reading the `d1_migrations` table in the target
database, running the files not listed there in order, and recording each one.
It is idempotent, so re-running does nothing.

**Migrations must be backwards compatible.** Deploys come from Cloudflare's Git
integration, which is a separate pipeline from CI, so the two race — the new
Worker can go live before or after the migration lands. Add columns and tables
freely, but split anything destructive across two merges: ship the code that
stops using a column first, then drop it. `npm run db:migrate:remote` still
works locally if a migration ever needs applying by hand.

## Querying from code

Bindings are only available per request, via `cloudflare:workers`:

```ts
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../lib/db/schema';

const db = drizzle(env.DB, { schema });
```

## Querying by hand

`wrangler d1 execute` runs SQL against either database. `--remote` is
production and `--local` is the file under `.wrangler/`:

```sh
npx wrangler d1 execute macandwen --remote --command "SELECT id, email, role FROM user"
```

That flag is the only thing separating a harmless test from a production write,
and leaving it off silently hits the local database instead — which usually
looks like the change simply not working. Useful additions: `--json` for output
that is readable when rows are wide, `--file ./script.sql` to run several
statements, and `-y` to skip the confirmation.

Making someone an admin is the standard case, since `role` is deliberately not
settable through the API. The row only exists once they have signed in:

```sh
npx wrangler d1 execute macandwen --remote \
  --command "UPDATE user SET role='admin' WHERE email='you@example.com'"
```

Check it afterwards, because a mistyped email updates nothing and still reports
success. The Cloudflare dashboard has an equivalent console under Workers &
Pages → D1 → macandwen, which is nicer for browsing.

Only ever use this for data. Schema changes belong in a migration — running
`ALTER TABLE` here drifts production away from `src/lib/db/schema.ts` and the
drizzle snapshots, and the next generated migration will conflict.

If a statement does damage, D1 keeps 30 days of history:

```sh
npx wrangler d1 time-travel info macandwen
npx wrangler d1 time-travel restore macandwen --timestamp <iso-timestamp>
```

## Local data

Each git worktree keeps its own database under `.wrangler/` (gitignored), so run
`npm run db:migrate:local` in a fresh worktree. Nothing needs installing: D1 is
SQLite, and Wrangler runs the Worker in a local runtime with SQLite built in, so
the database is just a file under `.wrangler/state/`. Delete that directory to
start over. To inspect it, or to rehearse anything destructive before running it
against production:

```sh
npx wrangler d1 execute macandwen --local --command "SELECT * FROM user"
```

## First-time setup

Already done for `macandwen` — kept for reference if another database is ever
added.

```sh
npx wrangler d1 create macandwen   # copy the id into wrangler.jsonc
npm run db:migrate:remote
```

That first remote apply is manual because the database has to exist before CI
can migrate it. Afterwards, leave it to CI.
