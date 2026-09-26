import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));
vi.mock('@/lib/db/transactionClient', () => ({ withUserTransaction: mocks.transaction }));

import { getQuestionById, listQuestionIds } from '@/lib/db/queries';
import { createFacultyDraft, replaceFacultyQuestions, saveFacultyDraftSettings, changeFacultyModuleStatus } from '@/lib/db/facultyModuleBuilder';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';
import { getStudentModuleLanding } from '@/lib/db/studentModules';
import { saveStudentResponse, startStudentAttempt, submitStudentAttempt } from '@/lib/db/moduleAttempts';
import { getFacultyOverview, getOwnedModuleAnalytics } from '@/lib/db/facultyAnalytics';
import { parseDraftSettings } from '@/lib/faculty/moduleInput';

let db: PGlite;
let facultyA: string;
let facultyB: string;
let students: string[];
let questionIds: string[];

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
  mocks.transaction.mockImplementation(async (work: (client: { query: typeof db.query }) => Promise<unknown>) => {
    await db.exec('begin');
    try { const result = await work({ query: db.query.bind(db) }); await db.exec('commit'); return result; }
    catch (error) { await db.exec('rollback'); throw error; }
  });
  const people = await db.query<{ id: string }>(`insert into users (email, name) values
    ('faculty-a@example.org','Faculty A'), ('faculty-b@example.org','Faculty B'),
    ('ada@example.org','Ada'), ('ben@example.org','Ben'), ('cy@example.org','Cy'), ('dee@example.org','Dee') returning id`);
  facultyA = people.rows[0]!.id; facultyB = people.rows[1]!.id;
  students = people.rows.slice(2).map((row) => row.id);
  questionIds = listQuestionIds({ sources: ['medmcqa'] }, 2);
});

afterEach(async () => { mocks.query.mockReset(); mocks.transaction.mockReset(); await db.close(); });

async function publish(owner: string, title: string): Promise<{ id: string; token: string }> {
  const id = await createFacultyDraft(owner, title);
  const { settings } = parseDraftSettings({
    revision: 0, title, description: '', instructions: '',
    opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    durationSeconds: 600, maxAttempts: 1, correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false,
  });
  await saveFacultyDraftSettings(owner, id, 0, settings);
  await replaceFacultyQuestions(owner, id, { ids: questionIds, revision: 1, allowReuse: true });
  await changeFacultyModuleStatus(owner, id, { action: 'publish', revision: 2, acceptReuse: true });
  return { id, token: (await getOwnedModuleDetail(owner, id))!.shareToken };
}

describe('faculty analytics on disposable PostgreSQL', () => {
  it('computes descriptive module analytics and paginated student results', async () => {
    const facultyModule = await publish(facultyA, 'Cohort mock');
    for (const student of students) await getStudentModuleLanding(facultyModule.token, student);
    const attempts = await Promise.all(students.slice(0, 3).map((student) => startStudentAttempt(facultyModule.token, student!)));
    const ada = attempts[0]!; const ben = attempts[1]!; const cy = attempts[2]!;
    const firstAnswer = getQuestionById(questionIds[0]!)!.answerIndex;
    const secondAnswer = getQuestionById(questionIds[1]!)!.answerIndex;
    await saveStudentResponse(students[0]!, ada.id, { position: 1, selectedIndex: firstAnswer, expectedRevision: 0 });
    await saveStudentResponse(students[0]!, ada.id, { position: 2, selectedIndex: ((secondAnswer + 1) % 4) as 0 | 1 | 2 | 3, expectedRevision: 0 });
    await submitStudentAttempt(ada.id, students[0]!);
    await saveStudentResponse(students[1]!, ben.id, { position: 1, selectedIndex: ((firstAnswer + 1) % 4) as 0 | 1 | 2 | 3, expectedRevision: 0 });
    await submitStudentAttempt(ben.id, students[1]!);

    const analytics = await getOwnedModuleAnalytics(facultyA, facultyModule.id, 1, 'ada');
    expect(analytics?.module).toMatchObject({ openedUsers: 4, uniqueStarters: 3, startedAttempts: 3,
      activeAttempts: 1, submittedAttempts: 2, expiredAttempts: 0, finalizedAttempts: 2,
      incompleteOpens: 1, completionPercent: 66.7 });
    expect(analytics?.scores).toMatchObject({ sampleSize: 2, mean: 1, median: 1, highest: 3, lowest: -1 });
    expect(analytics?.scores.highestParticipant?.email).toBe('ada@example.org');
    expect(analytics?.questions[0]).toMatchObject({ observations: 2, answered: 2, correct: 1, accuracyPercent: 50, skipPercent: 0 });
    expect(analytics?.questions[1]).toMatchObject({ observations: 2, answered: 1, correct: 0, accuracyPercent: 0, skipPercent: 50 });
    expect(analytics?.participants.items).toHaveLength(1);
    expect(analytics?.participants.items[0]?.studentEmail).toBe('ada@example.org');
    expect(cy.id).toBeTruthy();
  });

  it('enforces owner isolation for module and aggregate analytics', async () => {
    const own = await publish(facultyA, 'Private A');
    await publish(facultyB, 'Private B');
    expect(await getOwnedModuleAnalytics(facultyB, own.id)).toBeNull();
    const overviewA = await getFacultyOverview(facultyA);
    const overviewB = await getFacultyOverview(facultyB);
    expect(overviewA.modules.map((item) => item.title)).toEqual(['Private A']);
    expect(overviewB.modules.map((item) => item.title)).toEqual(['Private B']);
  });
});
