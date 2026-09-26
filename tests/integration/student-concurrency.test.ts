import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));
vi.mock('@/lib/db/transactionClient', () => ({ withUserTransaction: mocks.transaction }));

import { getQuestionById, listQuestionIds } from '@/lib/db/queries';
import { createFacultyDraft, replaceFacultyQuestions, saveFacultyDraftSettings, changeFacultyModuleStatus } from '@/lib/db/facultyModuleBuilder';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';
import { saveStudentResponse, startStudentAttempt, submitStudentAttempt } from '@/lib/db/moduleAttempts';
import { parseDraftSettings } from '@/lib/faculty/moduleInput';

let db: PGlite;
let facultyId: string;
let studentIds: string[];
let token: string;
let questionId: string;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create table users (
    id uuid primary key default gen_random_uuid(), email text unique not null,
    name text, image text, password_hash text
  )`);
  for (const name of ['001_faculty_foundation.sql', '002_faculty_builder.sql', '003_student_attempts.sql', '004_faculty_analytics.sql']) {
    await db.exec(await readFile(new URL(`../../scripts/db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  mocks.query.mockImplementation(async (statement: string, params: unknown[] = []) => (await db.query(statement, params)).rows);
  // PGlite owns a transaction mutex. Promise.all below presents concurrent
  // application calls, while the embedded single-process engine serializes DB
  // transactions; this is not evidence of hosted-Postgres parallel capacity.
  mocks.transaction.mockImplementation((work: (client: Transaction) => Promise<unknown>) => db.transaction(work));
  facultyId = (await db.query<{ id: string }>("insert into users (email) values ('faculty@example.org') returning id")).rows[0]!.id;
  studentIds = (await db.query<{ id: string }>(
    "insert into users (email) select 'student-' || n || '@example.org' from generate_series(1, 51) n returning id"
  )).rows.map((row) => row.id);
  questionId = listQuestionIds({ sources: ['medmcqa'] }, 1)[0]!;
  const moduleId = await createFacultyDraft(facultyId, 'Concurrency rehearsal');
  const { settings } = parseDraftSettings({ revision: 0, title: 'Concurrency rehearsal', description: '', instructions: '',
    opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    durationSeconds: 600, maxAttempts: 1, correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false });
  await saveFacultyDraftSettings(facultyId, moduleId, 0, settings);
  await replaceFacultyQuestions(facultyId, moduleId, { ids: [questionId], revision: 1, allowReuse: true });
  await changeFacultyModuleStatus(facultyId, moduleId, { action: 'publish', revision: 2, acceptReuse: true });
  token = (await getOwnedModuleDetail(facultyId, moduleId))!.shareToken;
});

afterEach(async () => { mocks.query.mockReset(); mocks.transaction.mockReset(); await db.close(); });

describe('logical concurrency rehearsal on PGlite', () => {
  it('preserves 50 concurrent start/save/submit call sequences without duplicate or lost records', async () => {
    const cohort = studentIds.slice(0, 50);
    const starts = await Promise.all(cohort.map((student) => startStudentAttempt(token, student)));
    expect(new Set(starts.map((attempt) => attempt.id)).size).toBe(50);
    expect(starts.every((attempt) => !attempt.resumed)).toBe(true);

    const answer = getQuestionById(questionId)!.answerIndex;
    await Promise.all(starts.map((attempt, index) => saveStudentResponse(cohort[index]!, attempt.id, {
      position: 1, selectedIndex: answer, expectedRevision: 0,
    })));
    const results = await Promise.all(starts.map((attempt, index) => submitStudentAttempt(attempt.id, cohort[index]!)));
    expect(results.every((result) => result.status === 'submitted' && result.score === 4)).toBe(true);
    const counts = await db.query<{ attempts: number; responses: number; submitted: number }>(`select
      (select count(*)::int from faculty_module_attempts) attempts,
      (select count(*)::int from faculty_module_responses) responses,
      (select count(*)::int from faculty_module_attempts where status = 'submitted') submitted`);
    expect(counts.rows[0]).toEqual({ attempts: 50, responses: 50, submitted: 50 });
  });

  it('coalesces duplicate concurrent starts for one student and transactionally enforces the limit', async () => {
    const student = studentIds[50]!;
    const starts = await Promise.all(Array.from({ length: 10 }, () => startStudentAttempt(token, student)));
    expect(new Set(starts.map((attempt) => attempt.id)).size).toBe(1);
    expect(starts.filter((attempt) => !attempt.resumed)).toHaveLength(1);
    await submitStudentAttempt(starts[0]!.id, student);
    const retries = await Promise.allSettled(Array.from({ length: 10 }, () => startStudentAttempt(token, student)));
    expect(retries.every((result) => result.status === 'rejected' &&
      typeof result.reason === 'object' && result.reason !== null && result.reason.status === 409)).toBe(true);
  });
});
