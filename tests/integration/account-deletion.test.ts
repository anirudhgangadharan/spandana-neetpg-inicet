import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db/transactionClient', () => ({ withUserTransaction: mocks.transaction }));

import { deleteAccount } from '@/lib/db/accountDeletion';

let db: PGlite;
let faculty: string;
let otherFaculty: string;
let student: string;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../../lib/db/userSchema.sql', import.meta.url), 'utf8'));
  for (const name of ['001_faculty_foundation.sql', '002_faculty_builder.sql', '003_student_attempts.sql', '004_faculty_analytics.sql', '005_guest_participants_corrections.sql']) {
    await db.exec(await readFile(new URL(`../../scripts/db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  mocks.transaction.mockImplementation(async (work: (client: { query: typeof db.query }) => Promise<unknown>) => {
    await db.exec('begin');
    try { const result = await work({ query: db.query.bind(db) }); await db.exec('commit'); return result; }
    catch (error) { await db.exec('rollback'); throw error; }
  });
  const people = await db.query<{ id: string }>(`insert into users (email) values
    ('faculty@example.org'), ('other@example.org'), ('student@example.org') returning id`);
  faculty = people.rows[0]!.id; otherFaculty = people.rows[1]!.id; student = people.rows[2]!.id;
});

afterEach(async () => { mocks.transaction.mockReset(); await db.close(); });

describe('account deletion on disposable PostgreSQL', () => {
  it('removes a faculty identity, grant, owned assessments, participant data, and ordinary progress atomically', async () => {
    const owned = await db.query<{ id: string }>(
      "insert into faculty_modules (owner_user_id, title) values ($1, 'Owned') returning id", [faculty]
    );
    const other = await db.query<{ id: string }>(
      "insert into faculty_modules (owner_user_id, title) values ($1, 'Other') returning id", [otherFaculty]
    );
    await db.query("insert into faculty_grants (email, user_id, status, slot) values ('faculty@example.org', $1, 'active', 1)", [faculty]);
    await db.query('insert into faculty_module_opens (module_id, student_user_id) values ($1, $2)', [owned.rows[0]!.id, student]);
    await db.query(`insert into faculty_module_attempts
      (module_id, student_user_id, attempt_number, deadline_at) values ($1, $2, 1, now() + interval '10 minutes')`,
    [owned.rows[0]!.id, student]);
    await db.query(`insert into faculty_module_attempts
      (module_id, student_user_id, attempt_number, deadline_at) values ($1, $2, 1, now() + interval '10 minutes')`,
    [other.rows[0]!.id, faculty]);
    await db.query("insert into sessions (user_id,sources,subjects,topics,mode,planned_count) values ($1,'[]','[]','[]','random',1)", [faculty]);
    await db.query("insert into bookmarks (user_id,question_id) values ($1,'q1')", [faculty]);

    expect(await deleteAccount(faculty, 'wrong@example.org')).toEqual({ deleted: false, ownedModulesDeleted: 0 });
    const result = await deleteAccount(faculty, 'FACULTY@example.org');
    expect(result).toEqual({ deleted: true, ownedModulesDeleted: 1 });
    expect((await db.query('select 1 from users where id = $1', [faculty])).rows).toHaveLength(0);
    expect((await db.query('select 1 from faculty_grants where email = $1', ['faculty@example.org'])).rows).toHaveLength(0);
    expect((await db.query('select 1 from faculty_modules where id = $1', [owned.rows[0]!.id])).rows).toHaveLength(0);
    expect((await db.query('select 1 from faculty_module_attempts')).rows).toHaveLength(0);
    expect((await db.query('select 1 from faculty_modules where id = $1', [other.rows[0]!.id])).rows).toHaveLength(1);
    expect((await db.query('select 1 from sessions where user_id = $1', [faculty])).rows).toHaveLength(0);
    expect((await db.query('select 1 from bookmarks where user_id = $1', [faculty])).rows).toHaveLength(0);
  });
});
