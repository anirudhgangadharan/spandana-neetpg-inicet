import { readFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
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
import { changeAnalyticsShare, getAnalyticsShareStatus, getSharedModuleAnalytics, hashAnalyticsToken } from '@/lib/db/moduleAnalyticsShares';

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
  for (const name of ['001_faculty_foundation.sql', '002_faculty_builder.sql', '003_student_attempts.sql', '004_faculty_analytics.sql', '005_guest_participants_corrections.sql', '006_module_analytics_shares.sql']) {
    await db.exec(await readFile(new URL(`../../scripts/db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  mocks.query.mockImplementation(async (statement: string, params: unknown[] = []) => (await db.query(statement, params)).rows);
  mocks.transaction.mockImplementation((work: Parameters<typeof db.transaction>[0]) => db.transaction(work));
  const people = await db.query<{ id: string }>(`insert into users (email, name) values
    ('faculty-a@example.org','Faculty A'), ('faculty-b@example.org','Faculty B'),
    ('ada@example.org','Ada'), ('ben@example.org','Ben'), ('cy@example.org','Cy'), ('dee@example.org','Dee') returning id`);
  facultyA = people.rows[0]!.id; facultyB = people.rows[1]!.id;
  await db.query(`insert into auth_identities (provider, provider_subject, user_id, verified_email)
    values ('google', 'faculty-a', $1, 'faculty-a@example.org')`, [facultyA]);
  await db.query(`insert into faculty_grants (email, user_id, slot) values ('faculty-a@example.org', $1, 1)`, [facultyA]);
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
  it('serializes competing replacements and revocations to one effective state', async () => {
    const id = await createFacultyDraft(facultyA, 'Concurrent sharing');
    const links = await Promise.all(Array.from({ length: 8 }, () => changeAnalyticsShare(facultyA, id, true)));
    const reads = await Promise.all(links.map((link) => getSharedModuleAnalytics(link!.token!)));
    expect(reads.filter(Boolean)).toHaveLength(1);
    const operations = await Promise.all([changeAnalyticsShare(facultyA, id, true), changeAnalyticsShare(facultyA, id, false)]);
    const status = await getAnalyticsShareStatus(facultyA, id);
    expect(Boolean(await getSharedModuleAnalytics(operations[0]!.token!))).toBe(status!.enabled);
  });

  it('paginates a representative synthetic cohort and records local query latency', async () => {
    const id = await createFacultyDraft(facultyA, 'Synthetic 200 × 200');
    await db.query(`insert into faculty_module_questions (module_id, position, question_id, source, stem, options, answer_index, subject, topic)
      select $1::uuid, n, 'synthetic-' || n, 'medmcqa', 'Synthetic question ' || n, '["A","B","C","D"]'::jsonb, 0, 'Medicine', 'Synthetic'
      from generate_series(1,200) n`, [id]);
    await db.exec(`insert into users (email, name) select 'benchmark-' || n || '@example.org', 'Synthetic student ' || n from generate_series(1,200) n`);
    await db.query(`insert into faculty_module_attempts (module_id, student_user_id, attempt_number, started_at, deadline_at)
      select $1::uuid, id, 1, now() - interval '30 minutes', now() + interval '30 minutes'
      from users where email like 'benchmark-%'`, [id]);
    await db.query(`insert into faculty_module_responses (attempt_id, module_id, position, selected_index, revision, active_time_ms)
      select a.id, a.module_id, q.position, 0, 0, 1000 from faculty_module_attempts a
      join faculty_module_questions q on q.module_id = a.module_id where a.module_id = $1::uuid`, [id]);
    await db.query(`update faculty_module_attempts set status = 'submitted', submitted_at = started_at + interval '30 minutes',
      score = 800, correct_count = 200, wrong_count = 0, unanswered_count = 0 where module_id = $1::uuid`, [id]);
    const token = (await changeAnalyticsShare(facultyA, id, true))!.token!;
    const first = (await getSharedModuleAnalytics(token))!;
    expect(first.scores.mean).toBe(800);
    expect(first.questions).toHaveLength(200);
    expect(first.questions[0]).toMatchObject({ observations: 200, accuracyPercent: 100, skipPercent: 0 });
    expect(first.participants.items).toHaveLength(50);
    expect(first.participants.hasNext).toBe(true);
    expect((await getSharedModuleAnalytics(token, 4))!.participants.hasNext).toBe(false);
    const timings: number[] = [];
    for (let batch = 0; batch < 4; batch++) await Promise.all(Array.from({ length: 4 }, async () => {
      const start = performance.now(); await getSharedModuleAnalytics(token); timings.push(performance.now() - start);
    }));
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ benchmark: 'shared-analytics-local', engine: 'PGlite 0.5.8 (serialized, not hosted capacity)',
      cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGiB: Math.round(totalmem() / 2 ** 30),
      questions: 200, attempts: 200, responses: 40000, concurrency: 4, reads: timings.length,
      p50Ms: Math.round(timings[7]!), p95Ms: Math.round(timings[15]!) }));
  });
  it('shares complete analytics without allowing cross-owner management or recording opens', async () => {
    const sharedModule = await publish(facultyA, 'Shared cohort');
    expect(await getAnalyticsShareStatus(facultyA, sharedModule.id)).toEqual({ enabled: false, createdAt: null });
    expect(await changeAnalyticsShare(facultyB, sharedModule.id, true)).toBeNull();
    expect(await changeAnalyticsShare(facultyB, sharedModule.id, false)).toBeNull();
    const link = (await changeAnalyticsShare(facultyA, sharedModule.id, true))!;
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await db.query<{ token_hash: string }>('select token_hash from faculty_module_analytics_shares');
    expect(stored.rows[0]!.token_hash).toBe(hashAnalyticsToken(link.token!));
    expect(await getSharedModuleAnalytics(sharedModule.token)).toBeNull();
    // Student test routes validate UUID tokens before reaching their DB query.
    expect(link.token).not.toMatch(/^[a-f0-9-]{36}$/i);
    const before = await getOwnedModuleAnalytics(facultyA, sharedModule.id);
    expect(await getSharedModuleAnalytics(link.token!)).toEqual(before);
    expect(await getOwnedModuleAnalytics(facultyA, sharedModule.id)).toEqual(before);
    expect(await getSharedModuleAnalytics('invalid')).toBeNull();
  });

  it('replaces, revokes, regenerates, and invalidates links on grant disablement and deletion', async () => {
    const sharedModule = await publish(facultyA, 'Lifecycle');
    const first = (await changeAnalyticsShare(facultyA, sharedModule.id, true))!.token!;
    const second = (await changeAnalyticsShare(facultyA, sharedModule.id, true))!.token!;
    expect(await getSharedModuleAnalytics(first)).toBeNull();
    expect(await getSharedModuleAnalytics(second)).not.toBeNull();
    await db.query("update faculty_modules set status = 'unpublished' where id = $1", [sharedModule.id]);
    expect(await getSharedModuleAnalytics(second)).not.toBeNull();
    await db.query("update faculty_modules set status = 'archived' where id = $1", [sharedModule.id]);
    expect(await getSharedModuleAnalytics(second)).not.toBeNull();
    await db.query("update faculty_grants set status = 'disabled', slot = null where user_id = $1", [facultyA]);
    expect(await getSharedModuleAnalytics(second)).toBeNull();
    await db.query("update faculty_grants set status = 'active', slot = 1 where user_id = $1", [facultyA]);
    await changeAnalyticsShare(facultyA, sharedModule.id, false);
    await changeAnalyticsShare(facultyA, sharedModule.id, false);
    expect(await getSharedModuleAnalytics(second)).toBeNull();
    const third = (await changeAnalyticsShare(facultyA, sharedModule.id, true))!.token!;
    await db.query('update faculty_modules set deleted_at = now() where id = $1', [sharedModule.id]);
    expect(await getSharedModuleAnalytics(third)).toBeNull();
    expect(await changeAnalyticsShare(facultyA, sharedModule.id, true)).toBeNull();
    await db.query('delete from faculty_modules where id = $1', [sharedModule.id]);
    expect((await db.query('select * from faculty_module_analytics_shares')).rows).toEqual([]);
  });

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
    const token = (await changeAnalyticsShare(facultyA, facultyModule.id, true))!.token!;
    const shared = await getSharedModuleAnalytics(token, 1, 'ada');
    expect(shared).toEqual({ ...analytics, participants: { ...analytics!.participants,
      items: analytics!.participants.items.map((item, index) => ({ ...item, attemptId: `row-${index}`, guestParticipantId: null })) } });
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
