import { describe, expect, it } from 'vitest';
import { getAuthTables } from 'better-auth/db';
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getAuth } from '../src/lib/auth';
import * as schema from '../src/lib/db/schema';

/**
 * `src/lib/db/schema.ts` is a hand-committed copy of tables better-auth owns,
 * so an upgrade can start expecting a column the database does not have — which
 * would otherwise first show up as a 500 in production.
 *
 * `getAuthTables` reports what the *installed* better-auth expects, derived from
 * the same options the app runs with, so this stays honest across upgrades.
 * When it fails, add the column to the schema and run `npm run db:generate`.
 */
describe('auth schema', () => {
  const tables = getAuthTables(getAuth().options);

  for (const [model, table] of Object.entries(tables)) {
    it(`declares every column better-auth expects on \`${table.modelName}\``, () => {
      const declared = schema[model as keyof typeof schema] as SQLiteTable | undefined;
      expect(declared, `no drizzle table exported for \`${model}\``).toBeDefined();

      const columns = Object.keys(getTableColumns(declared!));
      const expected = ['id', ...Object.keys(table.fields)];

      expect(columns).toEqual(expect.arrayContaining(expected));
    });
  }
});
