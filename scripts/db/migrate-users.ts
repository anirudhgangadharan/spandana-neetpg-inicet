/**
 * Applies lib/db/userSchema.sql only to an explicitly acknowledged database.
 * Idempotent (every statement is `create table/index if not exists`), so
 * it's safe to run again after adding a new statement to the schema file.
 *
 * Usage: MIGRATION_DATABASE_URL=... MIGRATION_TARGET=host/database
 *   pnpm data:users:migrate --apply
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
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

  const hash = createHash('sha256').update(schema).digest('hex');
  if (!process.argv.includes('--apply')) {
    console.log(`userSchema.sql  ${hash}  ${statements.length} statements`);
    console.log('Dry run only. No database connection was made.');
    return;
  }
  const connectionString = process.env['MIGRATION_DATABASE_URL'];
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is required for --apply; DATABASE_URL is never used.');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('MIGRATION_DATABASE_URL must be a Postgres URL.');
  const target = `${url.hostname}/${decodeURIComponent(url.pathname.slice(1))}`;
  if (process.env['MIGRATION_TARGET'] !== target) throw new Error(`Set MIGRATION_TARGET=${target} to acknowledge the exact target database.`);
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(784650190)');
    console.log(`Applying ${statements.length} statement(s) to ${target}...`);
    for (const statement of statements) await client.query(statement);
    await client.query('commit');
    console.log('Done.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
