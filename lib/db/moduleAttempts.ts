import type { PoolClient } from '@neondatabase/serverless';
import type { QuestionSource } from '@/types';
import { scoreModuleAnswers } from '@/lib/core/verdict';
import { withUserTransaction } from './transactionClient';

export class StudentAttemptError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = 'StudentAttemptError';
  }
}

interface ModuleRow {
  id: string;
  status: string;
  deleted_at: Date | string | null;
  opens_at: Date | string;
  closes_at: Date | string;
  duration_seconds: number;
  max_attempts: number;
}

interface AttemptRow {
  id: string;
  module_id: string;
  student_user_id: string;
  attempt_number: number;
  status: 'active' | 'submitted' | 'expired';
  started_at: Date | string;
  deadline_at: Date | string;
  submitted_at: Date | string | null;
  score: number | null;
  correct_count: number | null;
  wrong_count: number | null;
  unanswered_count: number | null;
  module_title: string;
  correct_points: number;
  wrong_points: number;
  blank_points: number;
  allow_review: boolean;
  question_count: number;
  activity_position: number | null;
  activity_observed_at: Date | string | null;
}

export interface StudentAttemptQuestion {
  readonly position: number;
  readonly id: string;
  readonly source: QuestionSource;
  readonly stem: string;
  readonly options: readonly [string, string, string, string];
  readonly subject: string;
  readonly topic: string | null;
}

export interface StudentSavedResponse {
  readonly position: number;
  readonly selectedIndex: 0 | 1 | 2 | 3 | null;
  readonly revision: number;
  readonly activeTimeMs: number | null;
  readonly savedAt: string;
}

export interface StudentAttemptReview extends StudentAttemptQuestion {
  readonly correctIndex: 0 | 1 | 2 | 3;
  readonly selectedIndex: 0 | 1 | 2 | 3 | null;
  readonly explanation: string | null;
}

export type StudentAttemptView =
  | {
      readonly status: 'active';
      readonly id: string;
      readonly title: string;
      readonly attemptNumber: number;
      readonly startedAt: string;
      readonly deadlineAt: string;
      readonly serverNow: string;
      readonly questions: readonly StudentAttemptQuestion[];
      readonly responses: readonly StudentSavedResponse[];
    }
  | {
      readonly status: 'submitted' | 'expired';
      readonly id: string;
      readonly title: string;
      readonly attemptNumber: number;
      readonly submittedAt: string;
      readonly score: number;
      readonly maxPoints: number;
      readonly correctCount: number;
      readonly wrongCount: number;
      readonly unansweredCount: number;
      readonly review: readonly StudentAttemptReview[] | null;
    };

const ATTEMPT_COLUMNS = `a.id, a.module_id, a.student_user_id, a.attempt_number,
  a.status, a.started_at, a.deadline_at, a.submitted_at, a.score,
  a.correct_count, a.wrong_count, a.unanswered_count,
  a.activity_position, a.activity_observed_at,
  m.title as module_title, m.correct_points, m.wrong_points, m.blank_points,
  m.allow_review,
  (select count(*)::int from faculty_module_questions q where q.module_id = a.module_id) as question_count`;
const RECEIPT_GRACE_MS = 10_000;

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

async function serverNow(client: PoolClient): Promise<Date> {
  const result = await client.query<{ server_now: Date | string }>('select clock_timestamp() as server_now');
  return new Date(result.rows[0]!.server_now);
}

async function lockedStudentAttempt(client: PoolClient, attemptId: string, studentId: string): Promise<AttemptRow> {
  const result = await client.query<AttemptRow>(
    `select ${ATTEMPT_COLUMNS} from faculty_module_attempts a
     join faculty_modules m on m.id = a.module_id
     where a.id = $1::uuid and a.student_user_id = $2::uuid for update of a`,
    [attemptId, studentId]
  );
  if (!result.rows[0]) throw new StudentAttemptError('Attempt not found.', 404);
  return result.rows[0];
}

const MAX_OBSERVED_SEGMENT_MS = 120_000;

/** Credit only elapsed database time between observed position transitions.
 * Each segment is capped at two minutes, so a background/abandoned tab cannot
 * become a fabricated long dwell time. This remains an estimate, not telemetry. */
async function recordObservedActivity(
  client: PoolClient,
  attempt: AttemptRow,
  now: Date,
  nextPosition: number | null
): Promise<void> {
  if (nextPosition !== null && nextPosition > attempt.question_count) {
    throw new StudentAttemptError('Question not in this attempt.', 404);
  }
  // Response writes are deliberately rejected by a database trigger once the
  // deadline has passed. Do not weaken that integrity boundary merely to
  // estimate the final dwell segment; late finalization records no extra time.
  const beforeDeadline = now.getTime() < new Date(attempt.deadline_at).getTime();
  if (beforeDeadline && attempt.activity_position !== null && attempt.activity_observed_at !== null) {
    const observedAt = new Date(attempt.activity_observed_at).getTime();
    const segmentEnd = Math.min(now.getTime(), new Date(attempt.deadline_at).getTime());
    const elapsed = Math.max(0, Math.floor(segmentEnd - observedAt));
    const credited = Math.min(elapsed, MAX_OBSERVED_SEGMENT_MS);
    if (credited > 0) {
      await client.query(
        `insert into faculty_module_responses
           (attempt_id, module_id, position, selected_index, revision, active_time_ms, saved_at)
         values ($1, $2, $3, null, 0, $4, $5)
         on conflict (attempt_id, position) do update set
           active_time_ms = least(43200000,
             coalesce(faculty_module_responses.active_time_ms, 0) + excluded.active_time_ms)`,
        [attempt.id, attempt.module_id, attempt.activity_position, credited, now]
      );
    }
  }
  await client.query(
    `update faculty_module_attempts set activity_position = $2,
       activity_observed_at = case when $2::smallint is null then null else $3::timestamptz end,
       updated_at = $3::timestamptz where id = $1`,
    [attempt.id, nextPosition, now]
  );
}

/** Caller holds FOR UPDATE on the attempt. Finalization is single-shot. */
async function finalizeLocked(
  client: PoolClient, attempt: AttemptRow, now: Date, status: 'submitted' | 'expired',
  answers?: readonly { position: number; selectedIndex: 0 | 1 | 2 | 3 }[]
): Promise<AttemptRow> {
  if (attempt.status !== 'active') return attempt;
  if (answers !== undefined && status === 'submitted') {
    if (answers.some((item) => item.position > attempt.question_count)) {
      throw new StudentAttemptError('Question not in this attempt.', 404);
    }
    // One atomic answer-sheet write; the database trigger also checks the
    // bounded receipt grace. Neither browser state nor client time is trusted.
    await client.query('delete from faculty_module_responses where attempt_id = $1', [attempt.id]);
    if (answers.length > 0) {
      await client.query(
        `insert into faculty_module_responses
           (attempt_id, module_id, position, selected_index, revision, saved_at)
         select $1::uuid, $2::uuid, item.position, item.selected_index, 1, clock_timestamp()
         from jsonb_to_recordset($3::jsonb) as item(position smallint, selected_index smallint)`,
        [attempt.id, attempt.module_id, JSON.stringify(answers.map((answer) => ({
          position: answer.position, selected_index: answer.selectedIndex,
        })))]
      );
    }
  }
  const result = await client.query<{ answer_index: number; selected_index: number | null }>(
    `select q.answer_index, r.selected_index from faculty_module_questions q
     left join faculty_module_responses r on r.module_id = q.module_id
       and r.position = q.position and r.attempt_id = $2::uuid
     where q.module_id = $1::uuid order by q.position`,
    [attempt.module_id, attempt.id]
  );
  if (result.rows.length !== attempt.question_count) throw new Error('Frozen module question count changed.');
  const scored = scoreModuleAnswers(result.rows.map((row) => ({
    answer: row.answer_index, selected: row.selected_index,
  })), {
    correct: attempt.correct_points, wrong: attempt.wrong_points, blank: attempt.blank_points,
  });
  const updated = await client.query<Pick<AttemptRow,
    'status' | 'submitted_at' | 'score' | 'correct_count' | 'wrong_count' | 'unanswered_count'>>(
      `update faculty_module_attempts set status = $2, submitted_at = $3,
         score = $4, correct_count = $5, wrong_count = $6, unanswered_count = $7,
         revision = revision + 1, updated_at = $3
       where id = $1 and status = 'active'
       returning status, submitted_at, score, correct_count, wrong_count, unanswered_count`,
      [attempt.id, status, now, scored.score, scored.correctCount, scored.wrongCount, scored.unansweredCount]
    );
  if (!updated.rows[0]) throw new Error('Locked attempt was not finalized.');
  return { ...attempt, ...updated.rows[0] };
}

export async function startStudentAttempt(token: string, studentId: string): Promise<{ id: string; resumed: boolean }> {
  const outcome = await withUserTransaction(async (client): Promise<
    { id: string; resumed: boolean } | { error: StudentAttemptError }
  > => {
    // One row lock per student allows 200 different students to start at once,
    // while serializing duplicate tabs for the same student and module.
    const user = await client.query('select id from users where id = $1::uuid for update', [studentId]);
    if (user.rows.length === 0) throw new StudentAttemptError('Student not found.', 404);
    const moduleResult = await client.query<ModuleRow>(
      `select id, status, deleted_at, opens_at, closes_at, duration_seconds, max_attempts
       from faculty_modules where share_token = $1::uuid for share`, [token]
    );
    const facultyModule = moduleResult.rows[0];
    if (!facultyModule) throw new StudentAttemptError('Module not found.', 404);
    const now = await serverNow(client);
    const active = await client.query<AttemptRow>(
      `select ${ATTEMPT_COLUMNS} from faculty_module_attempts a
       join faculty_modules m on m.id = a.module_id
       where a.module_id = $1 and a.student_user_id = $2 and a.status = 'active'
       for update of a`, [facultyModule.id, studentId]
    );
    const previous = active.rows[0];
    if (previous && now.getTime() < new Date(previous.deadline_at).getTime() + RECEIPT_GRACE_MS) {
      return { id: previous.id, resumed: true };
    }
    if (previous) await finalizeLocked(client, previous, now, 'expired');
    if (facultyModule.deleted_at !== null || facultyModule.status !== 'published') {
      return { error: new StudentAttemptError('Module is unavailable for new attempts.', 404) };
    }
    if (now.getTime() < new Date(facultyModule.opens_at).getTime() || now.getTime() >= new Date(facultyModule.closes_at).getTime()) {
      return { error: new StudentAttemptError('Module is outside its availability window.', 409) };
    }
    const count = await client.query<{ used: number }>(
      `select count(*)::int as used from faculty_module_attempts
       where module_id = $1 and student_user_id = $2`, [facultyModule.id, studentId]
    );
    const used = count.rows[0]!.used;
    if (used >= facultyModule.max_attempts) return { error: new StudentAttemptError('Attempt limit reached.', 409) };
    const deadline = new Date(Math.min(
      now.getTime() + facultyModule.duration_seconds * 1000, new Date(facultyModule.closes_at).getTime()
    ));
    const inserted = await client.query<{ id: string }>(
      `insert into faculty_module_attempts
         (module_id, student_user_id, attempt_number, started_at, deadline_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [facultyModule.id, studentId, used + 1, now, deadline]
    );
    return { id: inserted.rows[0]!.id, resumed: false };
  });
  if ('error' in outcome) throw outcome.error;
  return outcome;
}

export async function getStudentAttempt(attemptId: string, studentId: string): Promise<StudentAttemptView> {
  return withUserTransaction(async (client) => {
    let attempt = await lockedStudentAttempt(client, attemptId, studentId);
    const now = await serverNow(client);
    if (attempt.status === 'active' && now.getTime() >= new Date(attempt.deadline_at).getTime() + RECEIPT_GRACE_MS) {
      attempt = await finalizeLocked(client, attempt, now, 'expired');
    }
    if (attempt.status === 'active') {
      const questions = await client.query<{
        position: number; question_id: string; source: QuestionSource; stem: string;
        options: StudentAttemptQuestion['options']; subject: string; topic: string | null;
      }>(
        `select position, question_id, source, stem, options, subject, topic
         from faculty_module_questions where module_id = $1 order by position`, [attempt.module_id]
      );
      const responses = await client.query<{
        position: number; selected_index: 0 | 1 | 2 | 3 | null;
        revision: number; active_time_ms: number | null; saved_at: Date | string;
      }>(
        `select position, selected_index, revision, active_time_ms, saved_at
         from faculty_module_responses where attempt_id = $1 order by position`, [attempt.id]
      );
      return {
        status: 'active', id: attempt.id, title: attempt.module_title,
        attemptNumber: attempt.attempt_number, startedAt: iso(attempt.started_at),
        deadlineAt: iso(attempt.deadline_at), serverNow: iso(now),
        questions: questions.rows.map((q) => ({
          position: q.position, id: q.question_id, source: q.source, stem: q.stem,
          options: q.options, subject: q.subject, topic: q.topic,
        })),
        responses: responses.rows.map((r) => ({
          position: r.position, selectedIndex: r.selected_index, revision: r.revision,
          activeTimeMs: r.active_time_ms, savedAt: iso(r.saved_at),
        })),
      };
    }
    const review = attempt.allow_review ? await client.query<{
      position: number; question_id: string; source: QuestionSource; stem: string;
      options: StudentAttemptQuestion['options']; subject: string; topic: string | null;
      answer_index: 0 | 1 | 2 | 3; selected_index: 0 | 1 | 2 | 3 | null;
      explanation: string | null;
    }>(
      `select q.position, q.question_id, q.source, q.stem, q.options, q.subject,
         q.topic, q.answer_index, q.explanation, r.selected_index
       from faculty_module_questions q
       left join faculty_module_responses r on r.module_id = q.module_id
         and r.position = q.position and r.attempt_id = $2
       where q.module_id = $1 order by q.position`, [attempt.module_id, attempt.id]
    ) : null;
    return {
      status: attempt.status, id: attempt.id, title: attempt.module_title,
      attemptNumber: attempt.attempt_number, submittedAt: iso(attempt.submitted_at!),
      score: attempt.score!, maxPoints: attempt.question_count * Math.max(
        attempt.correct_points, attempt.wrong_points, attempt.blank_points
      ),
      correctCount: attempt.correct_count!, wrongCount: attempt.wrong_count!,
      unansweredCount: attempt.unanswered_count!,
      review: review ? review.rows.map((q) => ({
        position: q.position, id: q.question_id, source: q.source, stem: q.stem,
        options: q.options, subject: q.subject, topic: q.topic,
        correctIndex: q.answer_index, selectedIndex: q.selected_index,
        explanation: q.explanation,
      })) : null,
    };
  });
}

export async function saveStudentResponse(studentId: string, attemptId: string, input: {
  readonly position: number;
  readonly selectedIndex: 0 | 1 | 2 | 3 | null;
  readonly expectedRevision: number;
}): Promise<{ readonly expired: boolean; readonly response?: StudentSavedResponse }> {
  try {
    return await withUserTransaction(async (client) => {
    const attempt = await lockedStudentAttempt(client, attemptId, studentId);
    if (attempt.status !== 'active') throw new StudentAttemptError('Attempt is already finished.', 409);
    const now = await serverNow(client);
    if (now.getTime() >= new Date(attempt.deadline_at).getTime()) {
      await finalizeLocked(client, attempt, now, 'expired');
      return { expired: true };
    }
    if (input.position > attempt.question_count) throw new StudentAttemptError('Question not in this attempt.', 404);
    await recordObservedActivity(client, attempt, now, input.position);
    const current = await client.query<{
      selected_index: 0 | 1 | 2 | 3 | null; revision: number;
      active_time_ms: number | null; saved_at: Date | string;
    }>(
      `select selected_index, revision, active_time_ms, saved_at
       from faculty_module_responses where attempt_id = $1 and position = $2`,
      [attemptId, input.position]
    );
    const existing = current.rows[0];
    if (existing && existing.selected_index === input.selectedIndex) {
      return { expired: false, response: {
        position: input.position, selectedIndex: existing.selected_index,
        revision: existing.revision, activeTimeMs: existing.active_time_ms,
        savedAt: iso(existing.saved_at),
      } };
    }
    if (input.expectedRevision !== (existing?.revision ?? 0)) {
      throw new StudentAttemptError('This answer changed elsewhere. Reload before replacing it.', 409);
    }
    const saved = await client.query<{
      selected_index: 0 | 1 | 2 | 3 | null; revision: number;
      active_time_ms: number | null; saved_at: Date | string;
    }>(
      `insert into faculty_module_responses
         (attempt_id, module_id, position, selected_index, revision, saved_at)
       values ($1, $2, $3, $4, $5, clock_timestamp())
       on conflict (attempt_id, position) do update set
         selected_index = excluded.selected_index, revision = excluded.revision,
         saved_at = excluded.saved_at
       returning selected_index, revision, active_time_ms, saved_at`,
      [attemptId, attempt.module_id, input.position, input.selectedIndex,
        (existing?.revision ?? 0) + 1]
    );
    await client.query(
      `update faculty_module_attempts set revision = revision + 1, updated_at = clock_timestamp()
       where id = $1`, [attemptId]
    );
    const row = saved.rows[0]!;
    return { expired: false, response: {
      position: input.position, selectedIndex: row.selected_index, revision: row.revision,
      activeTimeMs: row.active_time_ms, savedAt: iso(row.saved_at),
    } };
    });
  } catch (error) {
    // The trigger may see the deadline pass between the transaction's clock
    // check and its INSERT. Reconcile that race as a finished attempt, not 500.
    if (error instanceof Error && error.message.includes('faculty attempt is no longer writable')) {
      const current = await getStudentAttempt(attemptId, studentId);
      if (current.status !== 'active') return { expired: true };
      throw new StudentAttemptError('Attempt is no longer writable.', 409);
    }
    throw error;
  }
}

export async function recordStudentActivity(
  studentId: string, attemptId: string, position: number | null
): Promise<{ readonly expired: boolean }> {
  return withUserTransaction(async (client) => {
    const attempt = await lockedStudentAttempt(client, attemptId, studentId);
    if (attempt.status !== 'active') throw new StudentAttemptError('Attempt is already finished.', 409);
    const now = await serverNow(client);
    if (now.getTime() >= new Date(attempt.deadline_at).getTime()) {
      await finalizeLocked(client, attempt, now, 'expired');
      return { expired: true };
    }
    await recordObservedActivity(client, attempt, now, position);
    return { expired: false };
  });
}

export async function submitStudentAttempt(
  attemptId: string, studentId: string,
  answers?: readonly { position: number; selectedIndex: 0 | 1 | 2 | 3 }[]
): Promise<StudentAttemptView> {
  try {
    await withUserTransaction(async (client) => {
      const attempt = await lockedStudentAttempt(client, attemptId, studentId);
      if (attempt.status !== 'active') return;
      const now = await serverNow(client);
      const status = now.getTime() >= new Date(attempt.deadline_at).getTime() + RECEIPT_GRACE_MS ? 'expired' : 'submitted';
      await finalizeLocked(client, attempt, now, status, status === 'submitted' ? answers : undefined);
    });
  } catch (error) {
    // The receipt window may close between the clock check and the database
    // trigger's answer insert. Resolve that race as an expired attempt.
    if (!(error instanceof Error) || !error.message.includes('faculty attempt is no longer writable')) throw error;
    await withUserTransaction(async (client) => {
      const attempt = await lockedStudentAttempt(client, attemptId, studentId);
      if (attempt.status === 'active') await finalizeLocked(client, attempt, await serverNow(client), 'expired');
    });
  }
  return getStudentAttempt(attemptId, studentId);
}

/** Invoke from a scheduler in bounded batches; also called lazily on attempt
 * access so expiry never depends on the browser's clock. */
export async function expireDueStudentAttempts(limit = 25): Promise<number> {
  return withUserTransaction(async (client) => {
    const due = await client.query<{ id: string; student_user_id: string }>(
      `select id, student_user_id from faculty_module_attempts
       where status = 'active' and deadline_at + interval '10 seconds' < clock_timestamp()
       order by deadline_at, id limit $1 for update skip locked`, [limit]
    );
    for (const item of due.rows) {
      const attempt = await lockedStudentAttempt(client, item.id, item.student_user_id);
      await finalizeLocked(client, attempt, await serverNow(client), 'expired');
    }
    return due.rows.length;
  });
}
