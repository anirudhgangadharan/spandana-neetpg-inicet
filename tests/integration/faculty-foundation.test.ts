import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));
vi.mock('@/lib/db/transactionClient', () => ({ withUserTransaction: mocks.transaction }));

import { getOwnedModule, listOwnedModules } from '@/lib/db/facultyModules';
import { activateFaculty, changeFacultyStatus, FacultyLimitError, listFacultyGrants } from '@/lib/db/facultyGrants';
import { AccountLinkRequiredError, upsertVerifiedGoogleUser } from '@/lib/db/userQueries';

let db: PGlite;
let professorA: string;
let professorB: string;
let superAdmin: string;
let student: string;
let ownedModuleId: string;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create table users (
    id uuid primary key default gen_random_uuid(), email text unique not null,
    name text, image text, password_hash text
  )`);
  await db.exec(await readFile(new URL('../../scripts/db/migrations/001_faculty_foundation.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../scripts/db/migrations/002_faculty_builder.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../scripts/db/migrations/003_student_attempts.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../scripts/db/migrations/004_faculty_analytics.sql', import.meta.url), 'utf8'));
  mocks.query.mockImplementation(async (statement: string, params: unknown[] = []) =>
    (await db.query(statement, params)).rows
  );
  mocks.transaction.mockImplementation(async (work: (client: { query: typeof db.query }) => Promise<unknown>) => {
    await db.exec('begin');
    try {
      const result = await work({ query: db.query.bind(db) });
      await db.exec('commit');
      return result;
    } catch (error) {
      await db.exec('rollback');
      throw error;
    }
  });
  const users = await db.query<{ id: string; email: string }>(
    `insert into users (email) values ('a@example.org'), ('b@example.org'), ('root@example.org'), ('student@example.org')
     returning id, email`
  );
  professorA = users.rows[0]!.id;
  professorB = users.rows[1]!.id;
  superAdmin = users.rows[2]!.id;
  student = users.rows[3]!.id;
  const owned = await db.query<{ id: string }>(
    `insert into faculty_modules (owner_user_id, title) values ($1, 'Private exam A') returning id`,
    [professorA]
  );
  ownedModuleId = owned.rows[0]!.id;
  await db.query(`insert into faculty_modules (owner_user_id, title) values ($1, 'Private exam B')`, [professorB]);
});

afterEach(async () => {
  mocks.query.mockReset();
  mocks.transaction.mockReset();
  await db.close();
});

describe('faculty foundation on disposable PostgreSQL', () => {
  it('applies the migration and isolates each owner in actual queries', async () => {
    expect((await listOwnedModules(professorA)).map((entry) => entry.title)).toEqual(['Private exam A']);
    expect((await listOwnedModules(professorB)).map((entry) => entry.title)).toEqual(['Private exam B']);
    expect(await getOwnedModule(professorB, ownedModuleId)).toBeNull();
    expect(await getOwnedModule(superAdmin, ownedModuleId)).toBeNull();
    expect((await getOwnedModule(professorA, ownedModuleId))?.id).toBe(ownedModuleId);
  });

  it('enforces the three-active-faculty cap at the database layer', async () => {
    for (let slot = 1; slot <= 3; slot += 1) {
      await db.query('insert into faculty_grants (email, slot) values ($1, $2)', [`prof${slot}@example.org`, slot]);
    }
    await expect(db.query(
      "insert into faculty_grants (email, slot) values ('fourth@example.org', 3)"
    )).rejects.toThrow();
    const count = await db.query<{ count: number }>("select count(*)::int as count from faculty_grants where status = 'active'");
    expect(count.rows[0]?.count).toBe(3);
  });

  it('limits faculty grants transactionally and frees a slot on disablement', async () => {
    for (let slot = 1; slot <= 3; slot += 1) {
      await activateFaculty(`prof${slot}@example.org`, superAdmin);
    }
    await expect(activateFaculty('fourth@example.org', superAdmin)).rejects.toBeInstanceOf(FacultyLimitError);
    const grants = await listFacultyGrants();
    expect(grants.filter((entry) => entry.status === 'active')).toHaveLength(3);
    await changeFacultyStatus(grants[0]!.id, 'disabled');
    await activateFaculty('fourth@example.org', superAdmin);
    expect((await listFacultyGrants()).filter((entry) => entry.status === 'active')).toHaveLength(3);
  });

  it('binds a grant only after verified Google sign-in and unbinds it when the email changes', async () => {
    await activateFaculty('a@example.org', superAdmin);
    expect((await listFacultyGrants())[0]?.bound).toBe(false);
    const linked = await upsertVerifiedGoogleUser('google-sub-a', 'a@example.org', 'Professor A', null);
    expect(linked.id).toBe(professorA);
    expect((await listFacultyGrants())[0]?.bound).toBe(true);
    await activateFaculty('new@example.org', superAdmin);
    await upsertVerifiedGoogleUser('google-sub-a', 'new@example.org', 'Professor A', null);
    const grants = await listFacultyGrants();
    expect(grants.find((entry) => entry.email === 'a@example.org')?.bound).toBe(false);
    expect(grants.find((entry) => entry.email === 'new@example.org')?.bound).toBe(true);
  });

  it('does not silently take over a preexisting password account by matching Google email', async () => {
    await db.query("insert into users (email, password_hash) values ('password@example.org', 'hashed')");
    await expect(upsertVerifiedGoogleUser(
      'google-sub-password', 'password@example.org', null, null
    )).rejects.toBeInstanceOf(AccountLinkRequiredError);
    const identities = await db.query<{ count: number }>('select count(*)::int as count from auth_identities');
    expect(identities.rows[0]?.count).toBe(0);
  });

  it('allows an owned module and its attempts to be deleted without orphaned responses', async () => {
    await db.query(
      `insert into faculty_module_questions
       (module_id, position, question_id, source, stem, options, answer_index, subject)
       values ($1, 1, 'm1', 'medmcqa', 'Question?', '["A","B","C","D"]', 0, 'Medicine')`,
      [ownedModuleId]
    );
    const attempt = await db.query<{ id: string }>(
      `insert into faculty_module_attempts (module_id, student_user_id, attempt_number, deadline_at)
       values ($1, $2, 1, now() + interval '1 hour') returning id`,
      [ownedModuleId, student]
    );
    await db.query(
      `insert into faculty_module_responses (attempt_id, module_id, position, selected_index, revision)
       values ($1, $2, 1, 2, 0)`,
      [attempt.rows[0]!.id, ownedModuleId]
    );
    await db.query('delete from faculty_modules where id = $1', [ownedModuleId]);
    const responses = await db.query<{ count: number }>('select count(*)::int as count from faculty_module_responses');
    expect(responses.rows[0]?.count).toBe(0);
  });
});
