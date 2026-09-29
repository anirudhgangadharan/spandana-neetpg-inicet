import type { PoolClient } from '@neondatabase/serverless';
import { moduleSnapshotFromQuestion } from '@/lib/core/question';
import { getManifest } from './client';
import { getQuestionsByIds } from './queries';
import { effectiveQuestions } from './questionCorrections';
import type { DraftSettings, parseAction, parseSelection } from '@/lib/faculty/moduleInput';
import { sql } from './userClient';
import { withUserTransaction } from './transactionClient';

export class FacultyModuleError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = 'FacultyModuleError';
  }
}

interface LockedModule {
  status: 'draft' | 'published' | 'unpublished' | 'archived';
  draft_revision: number;
  opens_at: Date | string | null;
  closes_at: Date | string | null;
  duration_seconds: number | null;
}

async function lockOwnedModule(client: PoolClient, ownerId: string, moduleId: string): Promise<LockedModule> {
  const result = await client.query<LockedModule>(
    `select status, draft_revision, opens_at, closes_at, duration_seconds
     from faculty_modules where id = $1 and owner_user_id = $2 and deleted_at is null for update`,
    [moduleId, ownerId]
  );
  const row = result.rows[0];
  if (!row) throw new FacultyModuleError('Module not found.', 404);
  return row;
}

function expectRevision(row: LockedModule, revision: number): void {
  if (row.draft_revision !== revision) {
    throw new FacultyModuleError('This module changed in another tab. Reload before continuing.', 409);
  }
}

async function usedElsewhere(client: PoolClient, ids: readonly string[], moduleId: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const result = await client.query<{ question_id: string }>(
    `select distinct question_id from faculty_module_questions
     where question_id = any($1::text[]) and module_id <> $2::uuid`,
    [ids, moduleId]
  );
  return result.rows.map((row) => row.question_id);
}

async function insertQuestionSnapshots(
  client: PoolClient,
  moduleId: string,
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  const resolved = await effectiveQuestions(getQuestionsByIds(ids), client);
  const questions = resolved.questions;
  if (questions.length !== ids.length || questions.some((question, index) => question.id !== ids[index] || !question.sessionEligible)) {
    throw new FacultyModuleError('A selected question is missing or unsuitable for an exam. Remove it and try again.', 409);
  }
  const snapshots = questions.map((question, index) => {
    const snapshot = moduleSnapshotFromQuestion(question);
    return {
      position: index + 1,
      question_id: snapshot.id,
      source: snapshot.source,
      stem: snapshot.stem,
      options: snapshot.options,
      answer_index: snapshot.answer,
      explanation: snapshot.explanation,
      subject: snapshot.subject,
      topic: snapshot.topic,
      flags: snapshot.flags,
      correction_version: resolved.versions.get(snapshot.id) ?? null,
    };
  });
  await client.query(
    `insert into faculty_module_questions
       (module_id, position, question_id, source, stem, options, answer_index,
        explanation, subject, topic, flags, correction_version)
     select $1::uuid, item.position, item.question_id, item.source, item.stem,
       item.options, item.answer_index, item.explanation, item.subject, item.topic, item.flags,
       item.correction_version
     from jsonb_to_recordset($2::jsonb) as item(
       position smallint, question_id text, source text, stem text, options jsonb,
       answer_index smallint, explanation text, subject text, topic text, flags jsonb,
       correction_version integer)`,
    [moduleId, JSON.stringify(snapshots)]
  );
}

export async function createFacultyDraft(ownerId: string, title: string): Promise<string> {
  const rows = (await sql.query(
    `insert into faculty_modules (owner_user_id, title) values ($1, $2) returning id`,
    [ownerId, title]
  )) as { id: string }[];
  if (!rows[0]) throw new Error('Draft creation returned no ID.');
  return rows[0].id;
}

export async function saveFacultyDraftSettings(
  ownerId: string, moduleId: string, revision: number, settings: DraftSettings
): Promise<void> {
  await withUserTransaction(async (client) => {
    const row = await lockOwnedModule(client, ownerId, moduleId);
    expectRevision(row, revision);
    if (row.status !== 'draft') throw new FacultyModuleError('Only draft settings can be edited.', 409);
    await client.query(
      `update faculty_modules set title = $3, description = $4, instructions = $5,
         opens_at = $6, closes_at = $7, duration_seconds = $8,
         max_attempts = $9, correct_points = $10, wrong_points = $11,
         blank_points = $12, allow_review = $13,
         draft_revision = draft_revision + 1, updated_at = now()
       where id = $1 and owner_user_id = $2`,
      [moduleId, ownerId, settings.title, settings.description, settings.instructions,
        settings.opensAt, settings.closesAt, settings.durationSeconds, settings.maxAttempts,
        settings.correctPoints, settings.wrongPoints, settings.blankPoints, settings.allowReview]
    );
  });
}

export async function replaceFacultyQuestions(
  ownerId: string,
  moduleId: string,
  selection: ReturnType<typeof parseSelection>
): Promise<void> {
  await withUserTransaction(async (client) => {
    const row = await lockOwnedModule(client, ownerId, moduleId);
    expectRevision(row, selection.revision);
    if (row.status !== 'draft') throw new FacultyModuleError('Only draft question sets can be edited.', 409);
    await client.query('select pg_advisory_xact_lock(784650193)');
    const used = await usedElsewhere(client, selection.ids, moduleId);
    if (used.length > 0 && !selection.allowReuse) {
      throw new FacultyModuleError(`${used.length} selected question(s) are already used in other modules. Confirm intentional reuse to include them.`, 409);
    }
    await client.query('delete from faculty_module_questions where module_id = $1', [moduleId]);
    await insertQuestionSnapshots(client, moduleId, selection.ids);
    await client.query(
      `update faculty_modules set draft_revision = draft_revision + 1, updated_at = now()
       where id = $1`, [moduleId]
    );
  });
}

export async function changeFacultyModuleStatus(
  ownerId: string,
  moduleId: string,
  input: ReturnType<typeof parseAction>
): Promise<void> {
  await withUserTransaction(async (client) => {
    const row = await lockOwnedModule(client, ownerId, moduleId);
    expectRevision(row, input.revision);
    if (input.action === 'publish') {
      if (row.status !== 'draft') throw new FacultyModuleError('Only a draft can be published.', 409);
      if (!row.opens_at || !row.closes_at || !row.duration_seconds) {
        throw new FacultyModuleError('Set opening, closing, and duration before publishing.', 409);
      }
      if (new Date(row.closes_at).getTime() <= Date.now()) {
        throw new FacultyModuleError('The closing time must be in the future.', 409);
      }
      const result = await client.query<{ question_id: string }>(
        'select question_id from faculty_module_questions where module_id = $1 order by position', [moduleId]
      );
      const ids = result.rows.map((selected) => selected.question_id);
      if (ids.length < 1 || ids.length > 200) throw new FacultyModuleError('Select 1–200 questions before publishing.', 409);
      await client.query('select pg_advisory_xact_lock(784650193)');
      const used = await usedElsewhere(client, ids, moduleId);
      if (used.length > 0 && !input.acceptReuse) {
        throw new FacultyModuleError(`${used.length} question(s) are now used in other modules. Confirm intentional reuse before publishing.`, 409);
      }
      // Re-read all selected IDs from the trusted, integrity-checked corpus at
      // publication. Draft-time text cannot silently become exam content.
      const corpusHash = getManifest().answerKeyHash;
      await client.query('delete from faculty_module_questions where module_id = $1', [moduleId]);
      await insertQuestionSnapshots(client, moduleId, ids);
      await client.query(
        `update faculty_modules set status = 'published', corpus_hash = $2,
           published_at = now(), updated_at = now(), draft_revision = draft_revision + 1
         where id = $1`, [moduleId, corpusHash]
      );
      return;
    }

    if (input.action === 'unpublish' && row.status !== 'published') {
      throw new FacultyModuleError('Only a published module can be unpublished.', 409);
    }
    if (input.action === 'republish' && row.status !== 'unpublished') {
      throw new FacultyModuleError('Only an unpublished module can be republished.', 409);
    }
    if (input.action === 'republish' && (!row.closes_at || new Date(row.closes_at).getTime() <= Date.now())) {
      throw new FacultyModuleError('This module has closed. Create a new draft for a new window.', 409);
    }
    if (input.action === 'archive' && row.status !== 'published' && row.status !== 'unpublished') {
      throw new FacultyModuleError('Only published or unpublished modules can be archived.', 409);
    }
    const status = input.action === 'unpublish' ? 'unpublished'
      : input.action === 'republish' ? 'published' : 'archived';
    await client.query(
      `update faculty_modules set status = $2,
         archived_at = case when $2 = 'archived' then now() else archived_at end,
         draft_revision = draft_revision + 1, updated_at = now()
       where id = $1`, [moduleId, status]
    );
  });
}

export async function deleteFacultyModule(ownerId: string, moduleId: string, revision: number): Promise<void> {
  await withUserTransaction(async (client) => {
    const row = await lockOwnedModule(client, ownerId, moduleId);
    expectRevision(row, revision);
    if (row.status === 'draft') {
      await client.query('delete from faculty_modules where id = $1', [moduleId]);
    } else {
      // Keep published snapshots and attempts for history/privacy retention.
      // This removes the module from the owner's visible list but preserves
      // global used-question history. The retention policy is Milestone 5.
      await client.query(
        `update faculty_modules set status = 'archived', archived_at = coalesce(archived_at, now()),
           deleted_at = now(), draft_revision = draft_revision + 1, updated_at = now()
         where id = $1`, [moduleId]
      );
    }
  });
}
