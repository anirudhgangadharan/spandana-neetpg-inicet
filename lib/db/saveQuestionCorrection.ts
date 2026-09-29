import { getManifest } from './client';
import { getQuestionById } from './queries';
import { latestCorrections } from './questionCorrections';
import { withUserTransaction } from './transactionClient';
import { FacultyModuleError } from './facultyModuleBuilder';
import { ModuleInputError } from '@/lib/faculty/moduleInput';
import { moduleSnapshotFromQuestion } from '@/lib/core/question';

type Change = {
  revision: number;
  expectedVersion: number;
  stem?: string;
  options?: [string, string, string, string];
  correctOption?: number;
  explanation?: string | null;
  reason: string;
  restoreVersion?: number;
};

export function parseCorrection(input: unknown): Change {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ModuleInputError('Invalid correction.');
  const raw = input as Record<string, unknown>;
  const allowed = ['revision', 'expectedVersion', 'stem', 'options', 'correctOption', 'explanation', 'reason', 'restoreVersion'];
  if (Object.keys(raw).some((key) => !allowed.includes(key))) throw new ModuleInputError('Unexpected correction field.');
  if (!Number.isSafeInteger(raw['revision']) || (raw['revision'] as number) < 0 ||
      !Number.isSafeInteger(raw['expectedVersion']) || (raw['expectedVersion'] as number) < 0) {
    throw new ModuleInputError('Invalid revision.');
  }
  if (typeof raw['reason'] !== 'string' || raw['reason'].trim().length < 3 || raw['reason'].trim().length > 1000) {
    throw new ModuleInputError('Provide a correction reason (3–1000 characters).');
  }
  const revision = raw['revision'] as number;
  const expectedVersion = raw['expectedVersion'] as number;
  const reason = (raw['reason'] as string).trim();
  if (raw['restoreVersion'] !== undefined) {
    if (!Number.isSafeInteger(raw['restoreVersion']) || (raw['restoreVersion'] as number) < 0) {
      throw new ModuleInputError('Invalid version to restore.');
    }
    return { revision, expectedVersion, reason, restoreVersion: raw['restoreVersion'] as number };
  }
  if (typeof raw['stem'] !== 'string' || raw['stem'].trim().length < 1 || raw['stem'].trim().length > 12000 ||
    !Array.isArray(raw['options']) || raw['options'].length !== 4 ||
    raw['options'].some((option: unknown) => typeof option !== 'string' || option.trim().length < 1 || option.trim().length > 4000) ||
    !Number.isInteger(raw['correctOption']) || (raw['correctOption'] as number) < 1 || (raw['correctOption'] as number) > 4 ||
    (raw['explanation'] !== null && typeof raw['explanation'] !== 'string') ||
    (typeof raw['explanation'] === 'string' && raw['explanation'].length > 12000)) {
    throw new ModuleInputError('Enter a stem, four options, a correct option (1–4), and a valid explanation.');
  }
  return {
    revision, expectedVersion, reason,
    stem: raw['stem'].trim() as string,
    options: (raw['options'] as string[]).map((option) => option.trim()) as [string, string, string, string],
    correctOption: raw['correctOption'] as number,
    explanation: (raw['explanation'] as string | null)?.trim() || null,
  };
}

export async function saveQuestionCorrection(
  ownerId: string, moduleId: string, questionId: string, change: Change
): Promise<void> {
  const source = getQuestionById(questionId);
  if (!source) throw new FacultyModuleError('Question not found.', 404);
  const original = moduleSnapshotFromQuestion(source);
  await withUserTransaction(async (client) => {
    const moduleResult = await client.query<{ status: string; draft_revision: number }>(
      `select status, draft_revision from faculty_modules
       where id = $1 and owner_user_id = $2 and deleted_at is null for update`, [moduleId, ownerId]
    );
    const draft = moduleResult.rows[0];
    if (!draft) throw new FacultyModuleError('Module not found.', 404);
    if (draft.status !== 'draft') throw new FacultyModuleError('Only draft questions can be corrected.', 409);
    if (draft.draft_revision !== change.revision) throw new FacultyModuleError('Draft changed. Reload before editing.', 409);
    const selected = await client.query(
      'select 1 from faculty_module_questions where module_id = $1 and question_id = $2', [moduleId, questionId]
    );
    if (!selected.rows[0]) throw new FacultyModuleError('Select this question in the draft first.', 404);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [questionId]);
    const latest = (await latestCorrections([questionId], client)).get(questionId);
    if ((latest?.version ?? 0) !== change.expectedVersion) {
      throw new FacultyModuleError('Question was corrected elsewhere. Reload before editing.', 409);
    }
    let next = {
      stem: change.stem ?? '', options: change.options ?? original.options,
      answer: (change.correctOption ?? 1) - 1, explanation: change.explanation ?? null,
    };
    if (change.restoreVersion !== undefined) {
      if (change.restoreVersion === 0) {
        next = { stem: original.stem, options: original.options, answer: original.answer,
          explanation: original.explanation };
      } else {
        const prior = await client.query<{
          stem: string; options: [string, string, string, string]; answer_index: number; explanation: string | null
        }>(
          'select stem, options, answer_index, explanation from question_corrections where question_id = $1 and version = $2',
          [questionId, change.restoreVersion]
        );
        if (!prior.rows[0]) throw new FacultyModuleError('Correction version not found.', 404);
        next = { stem: prior.rows[0].stem, options: prior.rows[0].options,
          answer: prior.rows[0].answer_index, explanation: prior.rows[0].explanation };
      }
    }
    const version = (latest?.version ?? 0) + 1;
    await client.query(
      `insert into question_corrections
        (question_id, version, corpus_hash, stem, options, answer_index, explanation,
         reason, author_user_id, reverted_from)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [questionId, version, getManifest().answerKeyHash, next.stem, JSON.stringify(next.options),
        next.answer, next.explanation, change.reason, ownerId, change.restoreVersion ?? null]
    );
    await client.query(
      `update faculty_module_questions set stem = $3, options = $4::jsonb, answer_index = $5,
         explanation = $6, correction_version = $7
       where module_id = $1 and question_id = $2`,
      [moduleId, questionId, next.stem, JSON.stringify(next.options), next.answer, next.explanation, version]
    );
    await client.query(
      `update faculty_modules set draft_revision = draft_revision + 1, updated_at = clock_timestamp() where id = $1`,
      [moduleId]
    );
  });
}
