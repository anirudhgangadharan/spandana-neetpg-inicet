import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), cookies: vi.fn() }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));
vi.mock('@/lib/db/transactionClient', () => ({ withUserTransaction: mocks.transaction }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

import { getQuestionById, listQuestionIds } from '@/lib/db/queries';
import { createFacultyDraft, replaceFacultyQuestions, saveFacultyDraftSettings, changeFacultyModuleStatus } from '@/lib/db/facultyModuleBuilder';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';
import { getStudentModuleLanding } from '@/lib/db/studentModules';
import {
  expireDueStudentAttempts, getStudentAttempt, saveStudentResponse,
  recordStudentActivity, startStudentAttempt, submitStudentAttempt,
} from '@/lib/db/moduleAttempts';
import { parseDraftSettings } from '@/lib/faculty/moduleInput';
import { deleteGuestParticipant, enrollGuest, getGuestStudentId, issueGuestRecovery, parseGuestIdentity, redeemGuestRecovery, setGuestCookie } from '@/lib/db/guestStudents';
import { getOwnedModuleAnalytics } from '@/lib/db/facultyAnalytics';

let db: PGlite;
let facultyId: string;
let studentA: string;
let studentB: string;
let questionId: string;
let guestCookies: Map<string, string>;

beforeEach(async () => {
  guestCookies = new Map();
  mocks.cookies.mockImplementation(async () => ({
    set: (name: string, value: string) => guestCookies.set(name, value),
    get: (name: string) => guestCookies.has(name) ? { value: guestCookies.get(name) } : undefined,
    getAll: () => [...guestCookies].map(([name, value]) => ({ name, value })),
  }));
  db = new PGlite();
  await db.exec(`create table users (
    id uuid primary key default gen_random_uuid(), email text unique not null,
    name text, image text, password_hash text
  )`);
  for (const name of ['001_faculty_foundation.sql', '002_faculty_builder.sql', '003_student_attempts.sql', '004_faculty_analytics.sql', '005_guest_participants_corrections.sql']) {
    await db.exec(await readFile(new URL(`../../scripts/db/migrations/${name}`, import.meta.url), 'utf8'));
  }
  mocks.query.mockImplementation(async (statement: string, params: unknown[] = []) => (await db.query(statement, params)).rows);
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
  const people = await db.query<{ id: string }>(
    "insert into users (email) values ('faculty@example.org'), ('student-a@example.org'), ('student-b@example.org') returning id"
  );
  facultyId = people.rows[0]!.id;
  studentA = people.rows[1]!.id;
  studentB = people.rows[2]!.id;
  questionId = listQuestionIds({ sources: ['medmcqa'] }, 1)[0]!;
});

afterEach(async () => {
  mocks.query.mockReset();
  mocks.transaction.mockReset();
  mocks.cookies.mockReset();
  await db.close();
});

async function publishedModule(options: { review?: boolean; maxAttempts?: number; opensLater?: boolean } = {}): Promise<{
  id: string; token: string;
}> {
  const id = await createFacultyDraft(facultyId, 'Timed practice');
  const { settings } = parseDraftSettings({
    revision: 0, title: 'Timed practice', description: 'A short mock.', instructions: 'Answer independently.',
    opensAt: new Date(Date.now() + (options.opensLater ? 60_000 : -60_000)).toISOString(),
    closesAt: new Date(Date.now() + 3_600_000).toISOString(),
    durationSeconds: 600, maxAttempts: options.maxAttempts ?? 1,
    correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: options.review ?? false,
  });
  await saveFacultyDraftSettings(facultyId, id, 0, settings);
  await replaceFacultyQuestions(facultyId, id, { ids: [questionId], revision: 1, allowReuse: true });
  await changeFacultyModuleStatus(facultyId, id, { action: 'publish', revision: 2, acceptReuse: true });
  return { id, token: (await getOwnedModuleDetail(facultyId, id))!.shareToken };
}

describe('student attempts on disposable PostgreSQL and frozen corpus', () => {
  it('stores no answer until one atomic final sheet, then returns the same result on retry', async () => {
    const facultyModule = await publishedModule();
    const started = await startStudentAttempt(facultyModule.token, studentA);
    const answer = getQuestionById(questionId)!.answerIndex;
    const before = await db.query<{ count: number }>(
      'select count(*)::int count from faculty_module_responses where attempt_id = $1', [started.id]
    );
    expect(before.rows[0]?.count).toBe(0);
    const sheet = [{ position: 1, selectedIndex: answer }];
    const result = await submitStudentAttempt(started.id, studentA, sheet);
    expect(result).toMatchObject({ status: 'submitted', score: 4, correctCount: 1 });
    expect(await submitStudentAttempt(started.id, studentA, sheet)).toEqual(result);
    const after = await db.query<{ count: number }>(
      'select count(*)::int count from faculty_module_responses where attempt_id = $1', [started.id]
    );
    expect(after.rows[0]?.count).toBe(1);
    await expect(submitStudentAttempt(started.id, studentB, sheet)).rejects.toMatchObject({ status: 404 });
  });

  it('registers a guest, rejects duplicate identifiers, exposes identity only to its faculty, and recovers once', async () => {
    const facultyModule = await publishedModule();
    const identity = parseGuestIdentity({ name: '  Ada  Rao ', registrationNumber: '0012', rollNumber: '07' });
    expect(identity.name).toBe('Ada Rao');
    expect(identity.registrationNumber).toBe('0012');
    expect(() => parseGuestIdentity({ name: ' ', registrationNumber: '0012', rollNumber: '07' })).toThrow('Name');
    const firstSession = await enrollGuest(facultyModule.token, identity);
    await setGuestCookie(firstSession, facultyModule.token);
    await expect(enrollGuest(facultyModule.token, { ...identity, registrationNumber: '0012', rollNumber: '07' }))
      .rejects.toMatchObject({ status: 409 });
    const participants = await db.query<{ id: string; student_user_id: string }>(
      'select id, student_user_id from guest_module_participants where module_id = $1', [facultyModule.id]
    );
    const participant = participants.rows[0]!;
    expect(await getGuestStudentId(facultyModule.token)).toBe(participant.student_user_id);
    guestCookies.set(`faculty_guest_${facultyModule.token}`, 'forged-token');
    expect(await getGuestStudentId(facultyModule.token)).toBeNull();
    await setGuestCookie(firstSession, facultyModule.token);
    const started = await startStudentAttempt(facultyModule.token, participant.student_user_id);
    expect(await getGuestStudentId(undefined, started.id)).toBe(participant.student_user_id);
    expect(await getGuestStudentId(undefined, studentA)).toBeNull();
    const answer = getQuestionById(questionId)!.answerIndex;
    await submitStudentAttempt(started.id, participant.student_user_id, [{ position: 1, selectedIndex: answer }]);
    const analytics = await getOwnedModuleAnalytics(facultyId, facultyModule.id);
    expect(analytics?.participants.items[0]).toMatchObject({ studentName: 'Ada Rao',
      registrationNumber: '0012', rollNumber: '07', score: 4, studentEmail: '' });
    await enrollGuest(facultyModule.token, { name: 'Other Student', registrationNumber: '0020', rollNumber: '08' });
    const other = await db.query<{ student_user_id: string }>(
      "select student_user_id from guest_module_participants where module_id = $1 and registration_number = '0020'",
      [facultyModule.id]
    );
    const otherAttempt = await startStudentAttempt(facultyModule.token, other.rows[0]!.student_user_id);
    expect(await getGuestStudentId(undefined, otherAttempt.id)).toBeNull();
    await expect(issueGuestRecovery(studentB, facultyModule.id, participant.id)).rejects.toMatchObject({ status: 404 });
    const code = await issueGuestRecovery(facultyId, facultyModule.id, participant.id);
    const newSession = await redeemGuestRecovery(facultyModule.token, code);
    expect(await getGuestStudentId(facultyModule.token)).toBeNull();
    await setGuestCookie(newSession, facultyModule.token);
    expect(await getGuestStudentId(facultyModule.token)).toBe(participant.student_user_id);
    await expect(redeemGuestRecovery(facultyModule.token, code)).rejects.toMatchObject({ status: 409 });
    await expect(deleteGuestParticipant(studentB, facultyModule.id, participant.id)).rejects.toMatchObject({ status: 404 });
    await deleteGuestParticipant(facultyId, facultyModule.id, participant.id);
    const erased = await db.query<{ count: number }>(
      'select count(*)::int count from faculty_module_attempts where id = $1', [started.id]
    );
    expect(erased.rows[0]?.count).toBe(0);
  });

  it('starts, autosaves, resumes, scores once, and hides answers under score-only policy', async () => {
    const facultyModule = await publishedModule();
    const landing = await getStudentModuleLanding(facultyModule.token, studentA);
    expect(landing.state).toBe('open');
    expect(JSON.stringify(landing)).not.toMatch(/answer_index|correctIndex|explanation/);
    const start = await startStudentAttempt(facultyModule.token, studentA);
    expect(start.resumed).toBe(false);
    expect((await startStudentAttempt(facultyModule.token, studentA))).toEqual({ id: start.id, resumed: true });
    const active = await getStudentAttempt(start.id, studentA);
    expect(active.status).toBe('active');
    expect(JSON.stringify(active)).not.toMatch(/answer_index|correctIndex|explanation/);
    const answer = getQuestionById(questionId)!.answerIndex;
    const saved = await saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: answer, expectedRevision: 0,
    });
    expect(saved.response?.revision).toBe(1);
    expect((await getStudentAttempt(start.id, studentA)).status).toBe('active');
    const result = await submitStudentAttempt(start.id, studentA);
    expect(result).toMatchObject({ status: 'submitted', score: 4, maxPoints: 4,
      correctCount: 1, wrongCount: 0, unansweredCount: 0, review: null });
    expect(await submitStudentAttempt(start.id, studentA)).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/answer_index|correctIndex|explanation/);
    await expect(saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: null, expectedRevision: 1,
    })).rejects.toMatchObject({ status: 409 });
    await expect(startStudentAttempt(facultyModule.token, studentA)).rejects.toMatchObject({ status: 409 });
  });

  it('reveals review only after finalization when enabled', async () => {
    const facultyModule = await publishedModule({ review: true });
    const start = await startStudentAttempt(facultyModule.token, studentA);
    expect(JSON.stringify(await getStudentAttempt(start.id, studentA))).not.toMatch(/correctIndex|explanation/);
    const answer = getQuestionById(questionId)!.answerIndex;
    await saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: ((answer + 1) % 4) as 0 | 1 | 2 | 3,
      expectedRevision: 0,
    });
    const result = await submitStudentAttempt(start.id, studentA);
    expect(result).toMatchObject({ status: 'submitted', score: -1, correctCount: 0, wrongCount: 1 });
    if (result.status === 'active') throw new Error('Expected a final result.');
    expect(result.review?.[0]?.correctIndex).toBe(answer);
    expect(result.review?.[0]?.stem).toBe(getQuestionById(questionId)?.stem);
  });

  it('records bounded server-observed question time without changing an answer', async () => {
    const facultyModule = await publishedModule();
    const start = await startStudentAttempt(facultyModule.token, studentA);
    await recordStudentActivity(studentA, start.id, 1);
    await db.query(
      "update faculty_module_attempts set activity_observed_at = now() - interval '5 minutes' where id = $1",
      [start.id]
    );
    await recordStudentActivity(studentA, start.id, null);
    const response = await db.query<{ active_time_ms: number; selected_index: number | null; revision: number }>(
      'select active_time_ms, selected_index, revision from faculty_module_responses where attempt_id = $1 and position = 1',
      [start.id]
    );
    expect(response.rows[0]).toMatchObject({ active_time_ms: 120_000, selected_index: null, revision: 0 });
    await expect(recordStudentActivity(studentB, start.id, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('expires using the database deadline and rejects late answers', async () => {
    const facultyModule = await publishedModule();
    const start = await startStudentAttempt(facultyModule.token, studentA);
    await db.query(
      "update faculty_module_attempts set started_at = now() - interval '3 hours', deadline_at = now() - interval '2 hours' where id = $1",
      [start.id]
    );
    const save = await saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: 0, expectedRevision: 0,
    });
    expect(save.expired).toBe(true);
    const result = await getStudentAttempt(start.id, studentA);
    expect(result).toMatchObject({ status: 'expired', score: 0, unansweredCount: 1 });
    await expect(db.query(
      `insert into faculty_module_responses (attempt_id, module_id, position, selected_index, revision)
       values ($1, $2, 1, 0, 1)`, [start.id, facultyModule.id]
    )).rejects.toThrow();
  });

  it('sweeps abandoned attempts and keeps expiry idempotent', async () => {
    const facultyModule = await publishedModule();
    const first = await startStudentAttempt(facultyModule.token, studentA);
    const second = await startStudentAttempt(facultyModule.token, studentB);
    await db.query(
      "update faculty_module_attempts set started_at = now() - interval '3 hours', deadline_at = now() - interval '2 hours' where id = any($1::uuid[])",
      [[first.id, second.id]]
    );
    expect(await expireDueStudentAttempts(25)).toBe(2);
    expect(await expireDueStudentAttempts(25)).toBe(0);
    expect((await getStudentAttempt(first.id, studentA)).status).toBe('expired');
    expect((await getStudentAttempt(second.id, studentB)).status).toBe('expired');
  });

  it('rejects stale edits and keeps each student isolated', async () => {
    const facultyModule = await publishedModule();
    const start = await startStudentAttempt(facultyModule.token, studentA);
    await expect(getStudentAttempt(start.id, studentB)).rejects.toMatchObject({ status: 404 });
    await expect(submitStudentAttempt(start.id, studentB)).rejects.toMatchObject({ status: 404 });
    const answer = getQuestionById(questionId)!.answerIndex;
    await saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: answer, expectedRevision: 0,
    });
    await expect(saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: null, expectedRevision: 0,
    })).rejects.toMatchObject({ status: 409 });
    expect((await saveStudentResponse(studentA, start.id, {
      position: 1, selectedIndex: answer, expectedRevision: 0,
    })).response?.revision).toBe(1);
  });

  it('allocates configured repeat attempts in order and stops at the limit', async () => {
    const facultyModule = await publishedModule({ maxAttempts: 2 });
    const first = await startStudentAttempt(facultyModule.token, studentA);
    await submitStudentAttempt(first.id, studentA);
    const second = await startStudentAttempt(facultyModule.token, studentA);
    expect(second.id).not.toBe(first.id);
    const active = await getStudentAttempt(second.id, studentA);
    expect(active.attemptNumber).toBe(2);
    await submitStudentAttempt(second.id, studentA);
    await expect(startStudentAttempt(facultyModule.token, studentA)).rejects.toMatchObject({ status: 409 });
  });

  it('enforces the window and resumes an active attempt after unpublication', async () => {
    const later = await publishedModule({ opensLater: true });
    expect((await getStudentModuleLanding(later.token, studentA)).state).toBe('upcoming');
    const recordedOpen = await db.query<{ count: number }>(
      'select count(*)::int as count from faculty_module_opens where module_id = $1 and student_user_id = $2',
      [later.id, studentA]
    );
    expect(recordedOpen.rows[0]?.count).toBe(1);
    await expect(startStudentAttempt(later.token, studentA)).rejects.toMatchObject({ status: 409 });
    const activeModule = await publishedModule();
    const start = await startStudentAttempt(activeModule.token, studentA);
    await changeFacultyModuleStatus(facultyId, activeModule.id, {
      action: 'unpublish', revision: 3, acceptReuse: false,
    });
    expect(await getStudentModuleLanding(activeModule.token, studentA)).toEqual({ state: 'resume', attemptId: start.id });
    expect(await startStudentAttempt(activeModule.token, studentA)).toEqual({ id: start.id, resumed: true });
    await expect(startStudentAttempt(activeModule.token, studentB)).rejects.toMatchObject({ status: 404 });
    await submitStudentAttempt(start.id, studentA);
    expect(await getStudentModuleLanding(activeModule.token, studentA)).toEqual({ state: 'finished', attemptId: start.id });
  });
});
