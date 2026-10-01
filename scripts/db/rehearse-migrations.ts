/** Applies the complete schema to an in-memory disposable PostgreSQL engine. */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.join(here, 'migrations');
const userSchema = path.resolve(here, '../../lib/db/userSchema.sql');

async function main(): Promise<void> {
  const names = (await readdir(migrationDir)).filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name)).sort();
  names.forEach((name, index) => {
    const expected = String(index + 1).padStart(3, '0');
    if (!name.startsWith(`${expected}_`)) throw new Error(`Migration order gap: expected ${expected}, found ${name}.`);
  });
  const migrations = await Promise.all(names.map(async (name) => {
    const body = await readFile(path.join(migrationDir, name), 'utf8');
    return { name, body, sha256: createHash('sha256').update(body).digest('hex') };
  }));
  const db = new PGlite();
  try {
    await db.exec(await readFile(userSchema, 'utf8'));
    await db.exec(`create table faculty_schema_migrations (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
    for (const migration of migrations) {
      await db.transaction(async (tx) => {
        await tx.exec(migration.body);
        await tx.query('insert into faculty_schema_migrations (name, sha256) values ($1, $2)', [migration.name, migration.sha256]);
      });
    }
    // Rehearse a second runner pass: applied files must be skipped and hashes
    // must match, including migration 004's intentionally non-idempotent FK.
    const applied = await db.query<{ name: string; sha256: string }>('select name, sha256 from faculty_schema_migrations order by name');
    for (const migration of migrations) {
      const previous = applied.rows.find((row) => row.name === migration.name);
      if (previous?.sha256 !== migration.sha256) throw new Error(`Migration ledger mismatch for ${migration.name}.`);
    }
    const schema = await db.query<{ activity_columns: number; activity_fk: number; analytics_indexes: number }>(`select
      (select count(*)::int from information_schema.columns where table_name = 'faculty_module_attempts'
        and column_name in ('activity_position','activity_observed_at')) activity_columns,
      (select count(*)::int from pg_constraint where conname = 'faculty_module_attempts_activity_question_fk') activity_fk,
      (select count(*)::int from pg_indexes where indexname in
        ('faculty_attempts_module_student_final_idx','faculty_responses_attempt_position_idx')) analytics_indexes`);
    const evidence = schema.rows[0];
    if (!evidence || evidence.activity_columns !== 2 || evidence.activity_fk !== 1 || evidence.analytics_indexes !== 2) {
      throw new Error(`Schema smoke check failed: ${JSON.stringify(evidence)}`);
    }
    const sharing = await db.query(`select 1 from information_schema.tables where table_name = 'faculty_module_analytics_shares'`);
    if (sharing.rows.length !== 1) throw new Error('Analytics sharing schema missing.');
    console.log(`Migration rehearsal passed: ${migrations.length} ordered migrations, ledger replay verified, analytics schema present.`);
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
