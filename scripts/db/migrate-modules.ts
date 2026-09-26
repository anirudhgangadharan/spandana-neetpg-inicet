/**
 * Versioned faculty-module migrations. Dry run by default and deliberately
 * independent of DATABASE_URL/.env.local, which may point at production.
 *
 * Apply only to a disposable database or Neon branch:
 *   MIGRATION_DATABASE_URL=... MIGRATION_TARGET=host/database \
 *     pnpm data:modules:migrate --apply
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';

const migrationDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

interface Migration {
  readonly name: string;
  readonly body: string;
  readonly sha256: string;
}

async function readMigrations(): Promise<Migration[]> {
  const names = (await readdir(migrationDir)).filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const body = await readFile(path.join(migrationDir, name), 'utf8');
    return { name, body, sha256: createHash('sha256').update(body).digest('hex') };
  }));
}

function confirmedConnectionString(): string {
  const value = process.env['MIGRATION_DATABASE_URL'];
  if (!value) throw new Error('MIGRATION_DATABASE_URL is required for --apply; DATABASE_URL is never used.');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('MIGRATION_DATABASE_URL must be a Postgres URL.');
  }
  const target = `${url.hostname}/${decodeURIComponent(url.pathname.slice(1))}`;
  if (process.env['MIGRATION_TARGET'] !== target) {
    throw new Error(`Set MIGRATION_TARGET=${target} to acknowledge the exact target database.`);
  }
  return value;
}

async function main(): Promise<void> {
  const migrations = await readMigrations();
  if (!process.argv.includes('--apply')) {
    for (const migration of migrations) console.log(`${migration.name}  ${migration.sha256}`);
    console.log('Dry run only. No database connection was made.');
    return;
  }

  const connectionString = confirmedConnectionString();
  neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(784650191)');
    await client.query(`create table if not exists faculty_schema_migrations (
      name text primary key,
      sha256 text not null,
      applied_at timestamptz not null default now()
    )`);
    const applied = await client.query<{ name: string; sha256: string }>(
      'select name, sha256 from faculty_schema_migrations'
    );
    const appliedByName = new Map(applied.rows.map((row) => [row.name, row.sha256]));
    for (const migration of migrations) {
      const previousHash = appliedByName.get(migration.name);
      if (previousHash !== undefined) {
        if (previousHash !== migration.sha256) throw new Error(`${migration.name} changed after it was applied.`);
        console.log(`already applied: ${migration.name}`);
        continue;
      }
      await client.query(migration.body);
      await client.query('insert into faculty_schema_migrations (name, sha256) values ($1, $2)', [
        migration.name, migration.sha256,
      ]);
      console.log(`applied: ${migration.name}`);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
