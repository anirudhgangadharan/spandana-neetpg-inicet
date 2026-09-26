import type { QuestionFlag, QuestionSource } from '@/types';
import { sql } from './userClient';

export type FacultyModuleStatus = 'draft' | 'published' | 'unpublished' | 'archived';

export interface FacultyModuleSummary {
  readonly id: string;
  readonly title: string;
  readonly status: FacultyModuleStatus;
  readonly createdAt: string;
  readonly questionCount: number;
  readonly openedCount: number;
  readonly startedCount: number;
  readonly submittedCount: number;
  readonly expiredCount: number;
}

export interface FacultySelectedQuestion {
  readonly id: string;
  readonly position: number;
  readonly source: QuestionSource;
  readonly stem: string;
  readonly options: readonly [string, string, string, string];
  readonly subject: string;
  readonly topic: string | null;
  readonly flags: readonly QuestionFlag[];
  readonly usedElsewhere: boolean;
}

export interface FacultyModuleDetail extends FacultyModuleSummary {
  readonly description: string | null;
  readonly instructions: string | null;
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly durationSeconds: number | null;
  readonly maxAttempts: number;
  readonly correctPoints: number;
  readonly wrongPoints: number;
  readonly blankPoints: number;
  readonly allowReview: boolean;
  readonly shareToken: string;
  readonly revision: number;
  readonly publishedAt: string | null;
  readonly selectedQuestions: readonly FacultySelectedQuestion[];
}

interface SummaryRow {
  id: string;
  title: string;
  status: FacultyModuleStatus;
  created_at: string | Date;
  question_count: number;
  opened_count: number;
  started_count: number;
  submitted_count: number;
  expired_count: number;
}

interface DetailRow extends SummaryRow {
  description: string | null;
  instructions: string | null;
  opens_at: string | Date | null;
  closes_at: string | Date | null;
  duration_seconds: number | null;
  max_attempts: number;
  correct_points: number;
  wrong_points: number;
  blank_points: number;
  allow_review: boolean;
  share_token: string;
  draft_revision: number;
  published_at: string | Date | null;
}

function iso(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function summaryFromRow(row: SummaryRow): FacultyModuleSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: iso(row.created_at)!,
    questionCount: row.question_count,
    openedCount: row.opened_count,
    startedCount: row.started_count,
    submittedCount: row.submitted_count,
    expiredCount: row.expired_count,
  };
}

const SUMMARY_COLUMNS = `fm.id, fm.title, fm.status, fm.created_at,
  (select count(*)::int from faculty_module_questions q where q.module_id = fm.id) as question_count,
  (select count(*)::int from faculty_module_opens o where o.module_id = fm.id) as opened_count,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id) as started_count,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id and a.status = 'submitted') as submitted_count,
  (select count(*)::int from faculty_module_attempts a where a.module_id = fm.id and a.status = 'expired') as expired_count`;

/** Every faculty read carries the ownership predicate in SQL. */
export async function listOwnedModules(ownerUserId: string, offset = 0, limit = 50): Promise<FacultyModuleSummary[]> {
  const rows = (await sql.query(
    `select ${SUMMARY_COLUMNS} from faculty_modules fm
     where fm.owner_user_id = $1 and fm.deleted_at is null
     order by fm.created_at desc, fm.id desc limit $2 offset $3`, [ownerUserId, limit, offset]
  )) as SummaryRow[];
  return rows.map(summaryFromRow);
}

export async function getOwnedModule(ownerUserId: string, moduleId: string): Promise<FacultyModuleSummary | null> {
  const rows = (await sql.query(
    `select ${SUMMARY_COLUMNS} from faculty_modules fm
     where fm.owner_user_id = $1 and fm.id = $2 and fm.deleted_at is null`,
    [ownerUserId, moduleId]
  )) as SummaryRow[];
  return rows[0] ? summaryFromRow(rows[0]) : null;
}

export async function getOwnedModuleDetail(ownerUserId: string, moduleId: string): Promise<FacultyModuleDetail | null> {
  const rows = (await sql.query(
    `select ${SUMMARY_COLUMNS}, fm.description, fm.instructions, fm.opens_at, fm.closes_at,
       fm.duration_seconds, fm.max_attempts, fm.correct_points, fm.wrong_points,
       fm.blank_points, fm.allow_review, fm.share_token, fm.draft_revision, fm.published_at
     from faculty_modules fm
     where fm.owner_user_id = $1 and fm.id = $2 and fm.deleted_at is null`,
    [ownerUserId, moduleId]
  )) as DetailRow[];
  const row = rows[0];
  if (!row) return null;
  const selected = (await sql.query(
    `select q.position, q.question_id, q.source, q.stem, q.options, q.subject, q.topic, q.flags,
       exists (select 1 from faculty_module_questions elsewhere
               where elsewhere.question_id = q.question_id and elsewhere.module_id <> q.module_id) as used_elsewhere
     from faculty_module_questions q
     join faculty_modules fm on fm.id = q.module_id
     where q.module_id = $1 and fm.owner_user_id = $2 and fm.deleted_at is null
     order by q.position`, [moduleId, ownerUserId]
  )) as {
    position: number; question_id: string; source: QuestionSource; stem: string;
    options: FacultySelectedQuestion['options']; subject: string; topic: string | null;
    flags: FacultySelectedQuestion['flags']; used_elsewhere: boolean;
  }[];
  return {
    ...summaryFromRow(row),
    description: row.description,
    instructions: row.instructions,
    opensAt: iso(row.opens_at),
    closesAt: iso(row.closes_at),
    durationSeconds: row.duration_seconds,
    maxAttempts: row.max_attempts,
    correctPoints: row.correct_points,
    wrongPoints: row.wrong_points,
    blankPoints: row.blank_points,
    allowReview: row.allow_review,
    shareToken: row.share_token,
    revision: row.draft_revision,
    publishedAt: iso(row.published_at),
    selectedQuestions: selected.map((question) => ({
      id: question.question_id,
      position: question.position,
      source: question.source,
      stem: question.stem,
      options: question.options,
      subject: question.subject,
      topic: question.topic,
      flags: question.flags,
      usedElsewhere: question.used_elsewhere,
    })),
  };
}
