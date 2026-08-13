/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

type Auth = import('./lib/auth').Auth;
type AuthSession = Awaited<ReturnType<Auth['api']['getSession']>>;

// Declared by hand because `wrangler types` infers secrets from .dev.vars,
// which is untracked — without this they vanish from Env on CI.
//
// `secrets.required` in wrangler.jsonc looks like the tidier answer, but
// declaring it makes wrangler read only those names from .dev.vars and ignore
// the rest of the file, so the local BETTER_AUTH_URL override is dropped and
// dev silently runs against the production URL. Do not reintroduce it.
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
  }
}

declare namespace App {
  interface Locals {
    user: (NonNullable<AuthSession>['user'] & { role?: string }) | null;
    session: NonNullable<AuthSession>['session'] | null;
  }
}
