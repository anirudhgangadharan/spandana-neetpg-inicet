/**
 * Applies lib/db/userSchema.sql to the Neon database named by DATABASE_URL.
 * Idempotent (every statement is `create table/index if not exists`), so
 * it's safe to run again after adding a new statement to the schema file.
 *
 * Usage: pnpm data:users:migrate
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    console.error('DATABASE_URL is not set. Add it to .env.local first.');
    process.exit(1);
  }

  const sql = neon(connectionString);
  const schemaPath = path.join(__dirname, '..', '..', 'lib', 'db', 'userSchema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  // Strip full-line comments first, THEN split on statement-terminating
  // semicolons — otherwise a statement preceded by its own comment block
  // gets dropped wholesale (its chunk's first line starts with `--`, but
  // the statement itself doesn't). The schema file has no semicolons
  // embedded in string literals, so splitting on `;` is safe without a
  // real SQL parser.
  const withoutComments = schema
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`Applying ${statements.length} statement(s) to the user database...`);
  for (const statement of statements) {
    const label = statement.split('\n')[0]?.slice(0, 60) ?? statement.slice(0, 60);
    process.stdout.write(`  ${label}... `);
    await sql.query(statement);
    console.log('ok');
  }
  console.log('Done.');
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
