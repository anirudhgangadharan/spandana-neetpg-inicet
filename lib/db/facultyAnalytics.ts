import { sql } from './userClient';
import type { FacultyModuleStatus } from './facultyModules';

export const ANALYTICS_SMALL_SAMPLE = 10;
export const FACULTY_PARTICIPANT_PAGE_SIZE = 50;

export interface DistributionBucket {
  readonly label: string;
  readonly count: number;
}

export interface AnalyticsBreakdown {
  readonly label: string;
  readonly questionCount: number;
  readonly observations: number;
  readonly answered: number;
  readonly correct: number;
  readonly skipped: number;
  readonly accuracyPercent: number | null;
  readonly skipPercent: number | null;
}

export interface QuestionAnalytics extends AnalyticsBreakdown {
  readonly position: number;
  readonly questionId: string;
  readonly subject: string;
  readonly topic: string | null;
  readonly estimatedTimeMs: number | null;
  readonly timingSamples: number;
}

export interface ParticipantResult {
  readonly attemptId: string;
  readonly studentName: string | null;
  readonly studentEmail: string;
  readonly registrationNumber: string | null;
  readonly rollNumber: string | null;
  readonly guestParticipantId: string | null;
  readonly attemptNumber: number;
  readonly status: 'active' | 'submitted' | 'expired';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly elapsedSeconds: number;
  readonly score: number | null;
  readonly correctCount: number | null;
  readonly wrongCount: number | null;
  readonly unansweredCount: number | null;
}

export interface ModuleAnalytics {
  readonly module: {
    readonly id: string;
    readonly title: string;
    readonly status: FacultyModuleStatus;
    readonly questionCount: number;
    readonly openedUsers: number;
    readonly uniqueStarters: number;
    readonly startedAttempts: number;
    readonly activeAttempts: number;
    readonly submittedAttempts: number;
    readonly expiredAttempts: number;
    readonly finalizedAttempts: number;
    readonly incompleteOpens: number;
    readonly completionPercent: number | null;
  };
  readonly scores: {
    readonly sampleSize: number;
    readonly mean: number | null;
    readonly median: number | null;
    readonly highest: number | null;
    readonly lowest: number | null;
    readonly highestParticipant: { readonly name: string | null; readonly email: string } | null;
    readonly lowestParticipant: { readonly name: string | null; readonly email: string } | null;
    readonly distribution: readonly DistributionBucket[];
  };
  readonly completionTimes: {
    readonly sampleSize: number;
    readonly medianSeconds: number | null;
    readonly distribution: readonly DistributionBucket[];
  };
  readonly questions: readonly QuestionAnalytics[];
  readonly subjects: readonly AnalyticsBreakdown[];
  readonly topics: readonly AnalyticsBreakdown[];
  readonly participants: {
    readonly items: readonly ParticipantResult[];
    readonly page: number;
    readonly hasNext: boolean;
    readonly search: string;
  };
}

export interface FacultyOverview {
  readonly modules: ReadonlyArray<ModuleAnalytics['module'] & {
    readonly createdAt: string;
    readonly meanScore: number | null;
    readonly needsAttention: boolean;
  }>;
  readonly totals: {
    readonly modules: number;
    readonly openedUsers: number;
    readonly startedAttempts: number;
    readonly finalizedAttempts: number;
  };
  readonly subjects: readonly AnalyticsBreakdown[];
  readonly topics: readonly AnalyticsBreakdown[];
  readonly frequentlyMissed: readonly QuestionAnalytics[];
}

interface ModuleRow {
  id: string; title: string; status: FacultyModuleStatus; created_at: string | Date;
  question_count: number; opened_users: number; unique_starters: number;
  started_attempts: number; active_attempts: number; submitted_attempts: number;
  expired_attempts: number; mean_score?: number | null;
}

interface FinalRow {
  score: number; elapsed_seconds: number; student_name: string | null; student_email: string;
}

interface QuestionRow {
  position: number; question_id: string; stem: string; subject: string; topic: string | null;
  observations: number; answered: number; correct: number; skipped: number;
  estimated_time_ms: number | null; timing_samples: number;
}

interface ParticipantRow {
  attempt_id: string; student_name: string | null; student_email: string;
  registration_number: string | null; roll_number: string | null; guest_participant_id: string | null;
  attempt_number: number; status: ParticipantResult['status']; started_at: string | Date;
  completed_at: string | Date | null; elapsed_seconds: number; score: number | null;
  correct_count: number | null; wrong_count: number | null; unanswered_count: number | null;
}

function integer(value: number | string): number { return Number(value); }
function decimal(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}
function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round(numerator / denominator * 1000) / 10;
}
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Fixed-width buckets are computed from persisted final values, never client input. */
export function distribution(values: readonly number[], bucketCount = 5): DistributionBucket[] {
  if (values.length === 0) return [];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return [{ label: `${low}`, count: values.length }];
  const width = (high - low) / bucketCount;
  const counts = Array.from({ length: bucketCount }, () => 0);
  for (const value of values) counts[Math.min(bucketCount - 1, Math.floor((value - low) / width))]! += 1;
  return counts.map((count, index) => {
    const start = low + width * index;
    const end = index === bucketCount - 1 ? high : low + width * (index + 1);
    return { label: `${Math.round(start * 10) / 10}–${Math.round(end * 10) / 10}`, count };
  });
}

function moduleFromRow(row: ModuleRow): ModuleAnalytics['module'] {
  const openedUsers = integer(row.opened_users);
  const uniqueStarters = integer(row.unique_starters);
  const startedAttempts = integer(row.started_attempts);
  const submittedAttempts = integer(row.submitted_attempts);
  const expiredAttempts = integer(row.expired_attempts);
  return {
    id: row.id, title: row.title, status: row.status,
    questionCount: integer(row.question_count), openedUsers, uniqueStarters, startedAttempts,
    activeAttempts: integer(row.active_attempts), submittedAttempts, expiredAttempts,
    finalizedAttempts: submittedAttempts + expiredAttempts,
    incompleteOpens: Math.max(0, openedUsers - uniqueStarters),
    completionPercent: percent(submittedAttempts + expiredAttempts, startedAttempts),
  };
}

function questionFromRow(row: QuestionRow): QuestionAnalytics {
  const observations = integer(row.observations);
  const answered = integer(row.answered);
  const correct = integer(row.correct);
  const skipped = integer(row.skipped);
  return {
    label: row.stem, position: integer(row.position), questionId: row.question_id,
    subject: row.subject, topic: row.topic, questionCount: 1, observations, answered,
    correct, skipped, accuracyPercent: percent(correct, answered),
    skipPercent: percent(skipped, observations), estimatedTimeMs: decimal(row.estimated_time_ms),
    timingSamples: integer(row.timing_samples),
  };
}

function groupQuestions(questions: readonly QuestionAnalytics[], key: 'subject' | 'topic'): AnalyticsBreakdown[] {
  const grouped = new Map<string, { questions: number; observations: number; answered: number; correct: number; skipped: number }>();
  for (const question of questions) {
    const label = key === 'subject' ? question.subject : (question.topic ?? 'Uncategorised');
    const current = grouped.get(label) ?? { questions: 0, observations: 0, answered: 0, correct: 0, skipped: 0 };
    current.questions += 1;
    current.observations += question.observations;
    current.answered += question.answered;
    current.correct += question.correct;
    current.skipped += question.skipped;
    grouped.set(label, current);
  }
  return [...grouped.entries()].map(([label, value]) => ({
    label, questionCount: value.questions, observations: value.observations,
    answered: value.answered, correct: value.correct, skipped: value.skipped,
    accuracyPercent: percent(value.correct, value.answered),
    skipPercent: percent(value.skipped, value.observations),
  })).sort((a, b) => (a.accuracyPercent ?? -1) - (b.accuracyPercent ?? -1) || a.label.localeCompare(b.label));
}

const MODULE_AGGREGATE = `
  (select count(*)::int from faculty_module_questions q where q.module_id = fm.id) question_count,
  (select count(*)::int from faculty_module_opens o where o.module_id = fm.id) opened_users,
  (select count(distinct a.student_user_id)::int from faculty_module_attempts a where a.module_id = fm.id) unique_starters,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id) started_attempts,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id and a.status = 'active') active_attempts,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id and a.status = 'submitted') submitted_attempts,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id and a.status = 'expired') expired_attempts`;

const QUESTION_AGGREGATE = `select q.position, q.question_id, q.stem, q.subject, q.topic,
  count(a.id)::int observations,
  count(*) filter (where r.selected_index is not null)::int answered,
  count(*) filter (where r.selected_index = q.answer_index)::int correct,
  count(a.id) filter (where r.selected_index is null)::int skipped,
  avg(r.active_time_ms) filter (where r.active_time_ms > 0)::float8 estimated_time_ms,
  count(*) filter (where r.active_time_ms > 0)::int timing_samples
 from faculty_module_questions q
 join faculty_modules fm on fm.id = q.module_id
 left join faculty_module_attempts a on a.module_id = q.module_id and a.status in ('submitted','expired')
 left join faculty_module_responses r on r.attempt_id = a.id and r.position = q.position
 where q.module_id = $1::uuid and fm.owner_user_id = $2::uuid and fm.deleted_at is null
 group by q.position, q.question_id, q.stem, q.subject, q.topic, q.answer_index
 order by q.position`;

export async function getOwnedModuleAnalytics(
  ownerUserId: string, moduleId: string, page = 1, search = ''
): Promise<ModuleAnalytics | null> {
  const moduleRows = await sql.query(
    `select fm.id, fm.title, fm.status, fm.created_at, ${MODULE_AGGREGATE}
     from faculty_modules fm where fm.id = $1::uuid and fm.owner_user_id = $2::uuid and fm.deleted_at is null`,
    [moduleId, ownerUserId]
  ) as ModuleRow[];
  const moduleRow = moduleRows[0];
  if (!moduleRow) return null;

  const finalRows = await sql.query(
    `select a.score::int score, coalesce(gp.name, u.name) student_name,
       case when gp.id is null then u.email else '' end student_email,
       greatest(0, extract(epoch from (least(a.submitted_at, a.deadline_at) - a.started_at)))::int elapsed_seconds
     from faculty_module_attempts a join faculty_modules fm on fm.id = a.module_id
     join users u on u.id = a.student_user_id
     left join guest_module_participants gp on gp.module_id = a.module_id and gp.student_user_id = a.student_user_id
     where a.module_id = $1::uuid and fm.owner_user_id = $2::uuid
       and a.status in ('submitted','expired') order by a.score`, [moduleId, ownerUserId]
  ) as FinalRow[];
  const questionRows = await sql.query(QUESTION_AGGREGATE, [moduleId, ownerUserId]) as QuestionRow[];
  const normalizedSearch = search.trim().slice(0, 120);
  const participantRows = await sql.query(
    `select a.id attempt_id, coalesce(gp.name, u.name) student_name,
       case when gp.id is null then u.email else '' end student_email,
       gp.registration_number, gp.roll_number, gp.id guest_participant_id, a.attempt_number,
       a.status, a.started_at, a.submitted_at completed_at,
       greatest(0, extract(epoch from (least(coalesce(a.submitted_at, clock_timestamp()), a.deadline_at) - a.started_at)))::int elapsed_seconds,
       a.score, a.correct_count, a.wrong_count, a.unanswered_count
     from faculty_module_attempts a
     join faculty_modules fm on fm.id = a.module_id
     join users u on u.id = a.student_user_id
     left join guest_module_participants gp on gp.module_id = a.module_id and gp.student_user_id = a.student_user_id
     where a.module_id = $1::uuid and fm.owner_user_id = $2::uuid
       and ($3 = '' or coalesce(gp.name, u.name, '') ilike '%' || $3 || '%'
         or (gp.id is null and u.email ilike '%' || $3 || '%')
         or gp.registration_number ilike '%' || $3 || '%'
         or gp.roll_number ilike '%' || $3 || '%')
     order by a.started_at desc, a.id desc limit $4 offset $5`,
    [moduleId, ownerUserId, normalizedSearch, FACULTY_PARTICIPANT_PAGE_SIZE + 1,
      (page - 1) * FACULTY_PARTICIPANT_PAGE_SIZE]
  ) as ParticipantRow[];

  const scores = finalRows.map((row) => integer(row.score));
  const times = finalRows.map((row) => integer(row.elapsed_seconds));
  const lowestRow = finalRows[0] ?? null;
  const highestRow = finalRows[finalRows.length - 1] ?? null;
  const questions = questionRows.map(questionFromRow);
  return {
    module: moduleFromRow(moduleRow),
    scores: {
      sampleSize: scores.length, mean: mean(scores), median: median(scores),
      highest: scores.length ? Math.max(...scores) : null,
      lowest: scores.length ? Math.min(...scores) : null,
      highestParticipant: highestRow ? { name: highestRow.student_name, email: highestRow.student_email } : null,
      lowestParticipant: lowestRow ? { name: lowestRow.student_name, email: lowestRow.student_email } : null,
      distribution: distribution(scores),
    },
    completionTimes: {
      sampleSize: times.length, medianSeconds: median(times), distribution: distribution(times),
    },
    questions,
    subjects: groupQuestions(questions, 'subject'), topics: groupQuestions(questions, 'topic'),
    participants: {
      items: participantRows.slice(0, FACULTY_PARTICIPANT_PAGE_SIZE).map((row) => ({
        attemptId: row.attempt_id, studentName: row.student_name, studentEmail: row.student_email,
        registrationNumber: row.registration_number, rollNumber: row.roll_number,
        guestParticipantId: row.guest_participant_id,
        attemptNumber: integer(row.attempt_number), status: row.status,
        startedAt: new Date(row.started_at).toISOString(),
        completedAt: row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
        elapsedSeconds: integer(row.elapsed_seconds), score: decimal(row.score),
        correctCount: decimal(row.correct_count), wrongCount: decimal(row.wrong_count),
        unansweredCount: decimal(row.unanswered_count),
      })),
      page, hasNext: participantRows.length > FACULTY_PARTICIPANT_PAGE_SIZE, search: normalizedSearch,
    },
  };
}

export async function getFacultyOverview(ownerUserId: string): Promise<FacultyOverview> {
  const rows = await sql.query(
    `select fm.id, fm.title, fm.status, fm.created_at, ${MODULE_AGGREGATE},
       (select avg(a.score)::float8 from faculty_module_attempts a
        where a.module_id = fm.id and a.status in ('submitted','expired')) mean_score
     from faculty_modules fm where fm.owner_user_id = $1::uuid and fm.deleted_at is null
     order by fm.created_at desc, fm.id desc`, [ownerUserId]
  ) as ModuleRow[];
  const questionRows = await sql.query(
    `select min(q.position)::int position, q.question_id, min(q.stem) stem, min(q.subject) subject, min(q.topic) topic,
       count(a.id)::int observations,
       count(*) filter (where r.selected_index is not null)::int answered,
       count(*) filter (where r.selected_index = q.answer_index)::int correct,
       count(a.id) filter (where r.selected_index is null)::int skipped,
       avg(r.active_time_ms) filter (where r.active_time_ms > 0)::float8 estimated_time_ms,
       count(*) filter (where r.active_time_ms > 0)::int timing_samples
     from faculty_module_questions q
     join faculty_modules fm on fm.id = q.module_id and fm.owner_user_id = $1::uuid and fm.deleted_at is null
     left join faculty_module_attempts a on a.module_id = q.module_id and a.status in ('submitted','expired')
     left join faculty_module_responses r on r.attempt_id = a.id and r.position = q.position
     group by q.question_id, q.answer_index
     order by q.question_id`, [ownerUserId]
  ) as QuestionRow[];
  const questions = questionRows.map(questionFromRow);
  const modules = rows.map((row) => {
    const item = moduleFromRow(row);
    return {
      ...item, createdAt: new Date(row.created_at).toISOString(), meanScore: decimal(row.mean_score ?? null),
      needsAttention: item.activeAttempts > 0 ||
        (item.startedAttempts >= 5 && (item.completionPercent ?? 0) < 50),
    };
  });
  const totals = modules.reduce((value, item) => ({
    modules: value.modules + 1, openedUsers: value.openedUsers + item.openedUsers,
    startedAttempts: value.startedAttempts + item.startedAttempts,
    finalizedAttempts: value.finalizedAttempts + item.finalizedAttempts,
  }), { modules: 0, openedUsers: 0, startedAttempts: 0, finalizedAttempts: 0 });
  return {
    modules, totals, subjects: groupQuestions(questions, 'subject'), topics: groupQuestions(questions, 'topic'),
    frequentlyMissed: [...questions].filter((item) => item.answered > 0)
      .sort((a, b) => (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101) || b.answered - a.answered)
      .slice(0, 10),
  };
}
