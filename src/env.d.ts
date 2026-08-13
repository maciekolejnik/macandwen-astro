/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

type Auth = import('./lib/auth').Auth;
type AuthSession = Awaited<ReturnType<Auth['api']['getSession']>>;

declare namespace App {
  interface Locals {
    user: (NonNullable<AuthSession>['user'] & { role?: string }) | null;
    session: NonNullable<AuthSession>['session'] | null;
  }
}
