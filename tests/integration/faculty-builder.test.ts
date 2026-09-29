import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));
vi.mock('@/lib/db/transactionClient', () => ({ withUserTransaction: mocks.transaction }));

import { getQuestionById, listFacultyCandidateWindow, listQuestionIds, UNCATEGORISED } from '@/lib/db/queries';
import { getOwnedModuleDetail, listOwnedModules } from '@/lib/db/facultyModules';
import { listFacultyCandidates, usedQuestionIds } from '@/lib/db/facultyQuestions';
import {
  changeFacultyModuleStatus, createFacultyDraft, deleteFacultyModule,
  FacultyModuleError, replaceFacultyQuestions, saveFacultyDraftSettings,
} from '@/lib/db/facultyModuleBuilder';
import { parseDraftSettings, parseSelection } from '@/lib/faculty/moduleInput';
import { parseCorrection, saveQuestionCorrection } from '@/lib/db/saveQuestionCorrection';
import { effectiveQuestions } from '@/lib/db/questionCorrections';

let db: PGlite;
let ownerA: string;
let ownerB: string;
let questionIds: string[];

beforeEach(async () => {
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
    "insert into users (email) values ('faculty-a@example.org'), ('faculty-b@example.org') returning id"
  );
  ownerA = people.rows[0]!.id;
  ownerB = people.rows[1]!.id;
  questionIds = listQuestionIds({ sources: ['medmcqa'] }, 2);
  expect(questionIds).toHaveLength(2);
});

afterEach(async () => {
  mocks.query.mockReset();
  mocks.transaction.mockReset();
  await db.close();
});

async function configuredDraft(ownerId: string): Promise<{ id: string; revision: number }> {
  const id = await createFacultyDraft(ownerId, 'Medicine practice');
  const { settings } = parseDraftSettings({
    revision: 0, title: 'Medicine practice', description: '', instructions: 'Work independently.',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    durationSeconds: 3600, maxAttempts: 1, correctPoints: 4, wrongPoints: -1,
    blankPoints: 0, allowReview: false,
  });
  await saveFacultyDraftSettings(ownerId, id, 0, settings);
  return { id, revision: 1 };
}

describe('faculty builder on disposable PostgreSQL and read-only corpus', () => {
  it('versions a global correction, freezes published tests, and restores the source by audit entry', async () => {
    const id = questionIds[0]!;
    const source = getQuestionById(id)!;
    const old = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, old.id, { ids: [id], revision: 1, allowReuse: true });
    await changeFacultyModuleStatus(ownerA, old.id, { action: 'publish', revision: 2, acceptReuse: true });
    const draft = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, draft.id, { ids: [id], revision: 1, allowReuse: true });
    const newAnswer = ((source.answerIndex + 1) % 4) + 1;
    await saveQuestionCorrection(ownerA, draft.id, id, parseCorrection({
      revision: 2, expectedVersion: 0, stem: 'Corrected clinical question',
      options: [...source.options], correctOption: newAnswer, explanation: 'Reviewed source.',
      reason: 'Faculty verified the answer key.',
    }));
    expect((await effectiveQuestions([source])).questions[0]?.stem).toBe('Corrected clinical question');
    expect((await getOwnedModuleDetail(ownerA, draft.id))?.selectedQuestions[0]).toMatchObject({
      stem: 'Corrected clinical question', correctOption: newAnswer, correctionVersion: 1,
    });
    const originalSnapshot = await db.query<{ answer_index: number }>(
      'select answer_index from faculty_module_questions where module_id = $1', [old.id]
    );
    expect(originalSnapshot.rows[0]?.answer_index).toBe(source.answerIndex);
    const later = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, later.id, { ids: [id], revision: 1, allowReuse: true });
    await changeFacultyModuleStatus(ownerA, later.id, { action: 'publish', revision: 2, acceptReuse: true });
    const correctedSnapshot = await db.query<{ answer_index: number; correction_version: number }>(
      'select answer_index, correction_version from faculty_module_questions where module_id = $1', [later.id]
    );
    expect(correctedSnapshot.rows[0]).toMatchObject({ answer_index: newAnswer - 1, correction_version: 1 });
    await expect(saveQuestionCorrection(ownerA, draft.id, id, parseCorrection({
      revision: 2, expectedVersion: 0, restoreVersion: 0, reason: 'Try stale version.',
    }))).rejects.toMatchObject({ status: 409 });
    await saveQuestionCorrection(ownerA, draft.id, id, parseCorrection({
      revision: 3, expectedVersion: 1, restoreVersion: 0, reason: 'Restore imported source.',
    }));
    expect((await effectiveQuestions([source])).questions[0]?.stem).toBe(source.stem);
    expect((await db.query<{ answer_index: number }>(
      'select answer_index from faculty_module_questions where module_id = $1', [later.id]
    )).rows[0]?.answer_index).toBe(newAnswer - 1);
    const versions = await db.query<{ version: number; reverted_from: number | null }>(
      'select version, reverted_from from question_corrections where question_id = $1 order by version', [id]
    );
    expect(versions.rows).toEqual([{ version: 1, reverted_from: null }, { version: 2, reverted_from: 0 }]);
  });

  it('publishes an immutable snapshot and limits answer editing data to drafts', async () => {
    const draft = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, draft.id, { ids: [...questionIds].reverse(), revision: 1, allowReuse: false });
    const before = await getOwnedModuleDetail(ownerA, draft.id);
    expect(before?.selectedQuestions.map((question) => question.id)).toEqual([...questionIds].reverse());
    expect(before?.selectedQuestions[0]?.correctOption).toBeGreaterThanOrEqual(1);
    await changeFacultyModuleStatus(ownerA, draft.id, { action: 'publish', revision: 2, acceptReuse: false });
    const published = await getOwnedModuleDetail(ownerA, draft.id);
    expect(published?.status).toBe('published');
    expect(published?.selectedQuestions.map((question) => question.id)).toEqual([...questionIds].reverse());
    expect(JSON.stringify(published)).not.toMatch(/"(?:answer_index|answerIndex|correctOption|explanation)"\s*:/);
    const frozen = await db.query<{ answer_index: number; stem: string }>(
      'select answer_index, stem from faculty_module_questions where module_id = $1 and position = 1', [draft.id]
    );
    expect(frozen.rows[0]?.answer_index).toBe(getQuestionById(questionIds[1]!)?.answerIndex);
    await expect(db.query(
      "update faculty_module_questions set stem = 'tampered' where module_id = $1 and position = 1", [draft.id]
    )).rejects.toThrow();
    await expect(db.query(
      'delete from faculty_module_questions where module_id = $1 and position = 1', [draft.id]
    )).rejects.toThrow();
    const other = await configuredDraft(ownerB);
    await expect(db.query(
      'update faculty_module_questions set module_id = $2 where module_id = $1 and position = 1',
      [draft.id, other.id]
    )).rejects.toThrow();
    await expect(db.query("update faculty_modules set correct_points = 20 where id = $1", [draft.id])).rejects.toThrow();
    await expect(db.query('update faculty_modules set owner_user_id = $2 where id = $1', [draft.id, ownerB])).rejects.toThrow();
  });

  it('globally blocks reused questions unless explicitly overridden, including at publication', async () => {
    const first = await configuredDraft(ownerA);
    const second = await configuredDraft(ownerB);
    await replaceFacultyQuestions(ownerA, first.id, { ids: [questionIds[0]!], revision: 1, allowReuse: false });
    expect((await usedQuestionIds([questionIds[0]!], second.id)).has(questionIds[0]!)).toBe(true);
    await expect(replaceFacultyQuestions(ownerB, second.id, {
      ids: [questionIds[0]!], revision: 1, allowReuse: false,
    })).rejects.toBeInstanceOf(FacultyModuleError);
    await replaceFacultyQuestions(ownerB, second.id, {
      ids: [questionIds[0]!], revision: 1, allowReuse: true,
    });
    await expect(changeFacultyModuleStatus(ownerB, second.id, {
      action: 'publish', revision: 2, acceptReuse: false,
    })).rejects.toBeInstanceOf(FacultyModuleError);
    await changeFacultyModuleStatus(ownerB, second.id, { action: 'publish', revision: 2, acceptReuse: true });
    expect((await getOwnedModuleDetail(ownerB, second.id))?.status).toBe('published');
    expect(await getOwnedModuleDetail(ownerA, second.id)).toBeNull();
  });

  it('filters global reuse in bounded pages without revealing another owner or answer key', async () => {
    const draft = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, draft.id, { ids: [questionIds[0]!], revision: 1, allowReuse: false });
    const filter = {
      source: 'medmcqa' as const, search: '', includeExcluded: false, onlyUnused: true,
      moduleId: null, cursor: null, limit: 1,
    };
    const unused = await listFacultyCandidates(filter);
    expect(unused.candidates[0]?.id).toBe(questionIds[1]);
    const own = await listFacultyCandidates({ ...filter, moduleId: draft.id });
    expect(own.candidates[0]?.id).toBe(questionIds[0]);
    const all = await listFacultyCandidates({ ...filter, onlyUnused: false });
    expect(all.candidates[0]?.usedElsewhere).toBe(true);
    expect(JSON.stringify(all)).not.toMatch(/"(?:answer_index|answerIndex|explanation|ownerUserId|moduleId)"\s*:/);
  });

  it('combines source, subject, topic, flag and full-text filters in the corpus picker', () => {
    const question = getQuestionById(questionIds[0]!)!;
    const word = question.stem.match(/[\p{L}]{5,}/u)?.[0];
    expect(word).toBeTruthy();
    const page = listFacultyCandidateWindow({
      sources: [question.source], subjects: [question.subject],
      topics: [question.topic ?? UNCATEGORISED],
      ...(question.flags[0] ? { flags: [question.flags[0]] } : {}),
      includeIds: [question.id],
    }, word!, null, 25);
    expect(page.items.map((item) => item.question.id)).toEqual([question.id]);
  });

  it('keeps published usage after removal, while deleting a draft releases its selection', async () => {
    const published = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, published.id, { ids: [questionIds[0]!], revision: 1, allowReuse: false });
    await changeFacultyModuleStatus(ownerA, published.id, { action: 'publish', revision: 2, acceptReuse: false });
    await deleteFacultyModule(ownerA, published.id, 3);
    expect(await getOwnedModuleDetail(ownerA, published.id)).toBeNull();
    expect((await usedQuestionIds([questionIds[0]!], null)).has(questionIds[0]!)).toBe(true);
    expect((await listOwnedModules(ownerA)).find((entry) => entry.id === published.id)).toBeUndefined();

    const draft = await configuredDraft(ownerB);
    await replaceFacultyQuestions(ownerB, draft.id, { ids: [questionIds[1]!], revision: 1, allowReuse: false });
    await deleteFacultyModule(ownerB, draft.id, 2);
    expect((await usedQuestionIds([questionIds[1]!], null)).has(questionIds[1]!)).toBe(false);
  });

  it('unpublishes, republishes and archives without changing the frozen link or questions', async () => {
    const draft = await configuredDraft(ownerA);
    await replaceFacultyQuestions(ownerA, draft.id, { ids: [questionIds[0]!], revision: 1, allowReuse: false });
    await changeFacultyModuleStatus(ownerA, draft.id, { action: 'publish', revision: 2, acceptReuse: false });
    const published = await getOwnedModuleDetail(ownerA, draft.id);
    await changeFacultyModuleStatus(ownerA, draft.id, { action: 'unpublish', revision: 3, acceptReuse: false });
    await changeFacultyModuleStatus(ownerA, draft.id, { action: 'republish', revision: 4, acceptReuse: false });
    await changeFacultyModuleStatus(ownerA, draft.id, { action: 'archive', revision: 5, acceptReuse: false });
    const archived = await getOwnedModuleDetail(ownerA, draft.id);
    expect(archived?.status).toBe('archived');
    expect(archived?.shareToken).toBe(published?.shareToken);
    expect(archived?.selectedQuestions).toEqual(published?.selectedQuestions);
    await expect(changeFacultyModuleStatus(ownerA, draft.id, {
      action: 'republish', revision: 6, acceptReuse: false,
    })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects foreign ownership, stale revisions and more than 200 selections', async () => {
    const draft = await configuredDraft(ownerA);
    const { settings } = parseDraftSettings({
      revision: 1, title: 'Foreign edit', description: '', instructions: '',
      opensAt: null, closesAt: null, durationSeconds: null, maxAttempts: 1,
      correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false,
    });
    await expect(saveFacultyDraftSettings(ownerB, draft.id, 1, settings)).rejects.toMatchObject({ status: 404 });
    await expect(replaceFacultyQuestions(ownerB, draft.id, {
      ids: [questionIds[0]!], revision: 1, allowReuse: false,
    })).rejects.toMatchObject({ status: 404 });
    await expect(replaceFacultyQuestions(ownerA, draft.id, {
      ids: [questionIds[0]!], revision: 0, allowReuse: false,
    })).rejects.toMatchObject({ status: 409 });
    expect(() => parseSelection({ ids: Array.from({ length: 201 }, (_, index) => String(index)), revision: 1, allowReuse: false })).toThrow();
  });

  it('refuses publication without questions and refuses editing after publication', async () => {
    const draft = await configuredDraft(ownerA);
    await expect(changeFacultyModuleStatus(ownerA, draft.id, {
      action: 'publish', revision: 1, acceptReuse: false,
    })).rejects.toMatchObject({ status: 409 });
    await replaceFacultyQuestions(ownerA, draft.id, { ids: [questionIds[0]!], revision: 1, allowReuse: false });
    await changeFacultyModuleStatus(ownerA, draft.id, { action: 'publish', revision: 2, acceptReuse: false });
    await expect(replaceFacultyQuestions(ownerA, draft.id, {
      ids: [questionIds[1]!], revision: 3, allowReuse: false,
    })).rejects.toMatchObject({ status: 409 });
    expect((await getOwnedModuleDetail(ownerA, draft.id))?.selectedQuestions[0]?.id).toBe(questionIds[0]);
  });

  it('keeps older modules reachable through owner-scoped pages', async () => {
    await db.query(
      "insert into faculty_modules (owner_user_id, title) select $1, 'Draft ' || n from generate_series(1, 52) n",
      [ownerA]
    );
    await createFacultyDraft(ownerB, 'Other owner');
    const first = await listOwnedModules(ownerA, 0, 50);
    const second = await listOwnedModules(ownerA, 50, 50);
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(2);
    expect(new Set([...first, ...second].map((module) => module.id)).size).toBe(52);
    expect([...first, ...second].every((module) => module.title !== 'Other owner')).toBe(true);
  });
});
