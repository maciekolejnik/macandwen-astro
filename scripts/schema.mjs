#!/usr/bin/env node
/**
 * Regenerates the better-auth schema from `better-auth.config.ts`.
 *
 * Without arguments it checks that `src/lib/db/schema.ts` matches what the CLI
 * would produce and fails if it does not, which is how CI notices that a
 * better-auth upgrade expects columns the database does not have. With
 * `--write` it updates the schema in place.
 *
 * The CLI is published separately from the library, lags behind it, and brings
 * its own copy of it - that copy is what defines the tables it emits. So this
 * pin, not the version in package.json, decides what the check compares
 * against. After upgrading better-auth, raise this to the matching CLI release
 * and regenerate; a newer library's columns are invisible until then. Tracking
 * latest instead would break the build on unrelated CLI releases.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = '@better-auth/cli@1.4.21';
const SCHEMA = 'src/lib/db/schema.ts';

const write = process.argv.includes('--write');
const scratch = mkdtempSync(join(tmpdir(), 'schema-'));
const generated = join(scratch, 'schema.ts');

try {
  execFileSync(
    'npx',
    ['-y', CLI, 'generate', '--config', './better-auth.config.ts', '--output', generated, '--yes'],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );

  if (write) {
    copyFileSync(generated, SCHEMA);
    console.log(`Wrote ${SCHEMA}. Run \`npm run db:generate\` if the tables changed.`);
    process.exit(0);
  }

  if (readFileSync(generated, 'utf8') === readFileSync(SCHEMA, 'utf8')) {
    console.log(`${SCHEMA} matches the generated schema.`);
    process.exit(0);
  }

  console.error(
    [
      '',
      `${SCHEMA} does not match what ${CLI} generates from better-auth.config.ts.`,
      '',
      'better-auth probably expects columns the database does not have yet. To fix:',
      '',
      '  npm run db:schema:generate   # update the schema',
      '  npm run db:generate          # write a migration for the difference',
      '',
      'Then commit both, and check the migration before merging.',
      '',
    ].join('\n'),
  );
  try {
    execFileSync('git', ['--no-pager', 'diff', '--no-index', '--', SCHEMA, generated], {
      stdio: 'inherit',
    });
  } catch {
    // git diff exits non-zero when files differ, which is the expected case.
  }
  process.exit(1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
