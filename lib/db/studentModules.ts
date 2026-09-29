import { sql } from './userClient';

export type StudentModuleLanding =
  | { readonly state: 'unavailable' }
  | { readonly state: 'resume'; readonly attemptId: string }
  | { readonly state: 'finished'; readonly attemptId: string }
  | { readonly state: 'upcoming'; readonly opensAt: string }
  | { readonly state: 'closed'; readonly lastAttemptId: string | null }
  | {
      readonly state: 'open';
      readonly title: string;
      readonly description: string | null;
      readonly instructions: string | null;
      readonly questionCount: number;
      readonly durationSeconds: number;
      readonly maxAttempts: number;
      readonly attemptsUsed: number;
      readonly activeAttemptId: string | null;
      readonly lastAttemptId: string | null;
      readonly correctPoints: number;
      readonly wrongPoints: number;
      readonly blankPoints: number;
      readonly allowReview: boolean;
      readonly opensAt: string;
      readonly closesAt: string;
    };

interface LandingRow {
  id: string;
  status: string;
  deleted_at: Date | string | null;
  opens_at: Date | string;
  closes_at: Date | string;
  server_now: Date | string;
  title: string;
  description: string | null;
  instructions: string | null;
  question_count: number;
  duration_seconds: number;
  max_attempts: number;
  correct_points: number;
  wrong_points: number;
  blank_points: number;
  allow_review: boolean;
  attempts_used: number;
  active_attempt_id: string | null;
  last_attempt_id: string | null;
}

/** Public metadata only; an unregistered visitor cannot see attempts or answers. */
export async function getPublicModuleLanding(token: string): Promise<StudentModuleLanding> {
  const rows = await sql.query(
    `select fm.status, fm.deleted_at, fm.opens_at, fm.closes_at,
       clock_timestamp() as server_now, fm.title, fm.description, fm.instructions,
       fm.duration_seconds, fm.max_attempts, fm.correct_points, fm.wrong_points,
       fm.blank_points, fm.allow_review,
       (select count(*)::int from faculty_module_questions q where q.module_id = fm.id) as question_count
     from faculty_modules fm where fm.share_token = $1::uuid`, [token]
  ) as LandingRow[];
  const row = rows[0];
  if (!row || row.deleted_at !== null || row.status !== 'published') return { state: 'unavailable' };
  const now = new Date(row.server_now).getTime();
  if (now < new Date(row.opens_at).getTime()) return { state: 'upcoming', opensAt: new Date(row.opens_at).toISOString() };
  if (now >= new Date(row.closes_at).getTime()) return { state: 'closed', lastAttemptId: null };
  return {
    state: 'open', title: row.title, description: row.description,
    instructions: row.instructions, questionCount: row.question_count,
    durationSeconds: row.duration_seconds, maxAttempts: row.max_attempts,
    attemptsUsed: 0, activeAttemptId: null, lastAttemptId: null,
    correctPoints: row.correct_points, wrongPoints: row.wrong_points,
    blankPoints: row.blank_points, allowReview: row.allow_review,
    opensAt: new Date(row.opens_at).toISOString(), closesAt: new Date(row.closes_at).toISOString(),
  };
}

/** Only signed-in students call this. The link token is an unguessable locator,
 * not authorization; role checks happen in the route before this query. */
export async function getStudentModuleLanding(token: string, studentId: string): Promise<StudentModuleLanding> {
  const rows = (await sql.query(
    `select fm.id, fm.status, fm.deleted_at, fm.opens_at, fm.closes_at,
       clock_timestamp() as server_now, fm.title, fm.description, fm.instructions,
       fm.duration_seconds, fm.max_attempts, fm.correct_points, fm.wrong_points,
       fm.blank_points, fm.allow_review,
       (select count(*)::int from faculty_module_questions q where q.module_id = fm.id) as question_count,
       (select count(*)::int from faculty_module_attempts a
         where a.module_id = fm.id and a.student_user_id = $2) as attempts_used,
       (select a.id from faculty_module_attempts a
         where a.module_id = fm.id and a.student_user_id = $2 and a.status = 'active'
         order by a.started_at desc limit 1) as active_attempt_id,
       (select a.id from faculty_module_attempts a
         where a.module_id = fm.id and a.student_user_id = $2
         order by a.attempt_number desc limit 1) as last_attempt_id
     from faculty_modules fm where fm.share_token = $1::uuid`,
    [token, studentId]
  )) as LandingRow[];
  const row = rows[0];
  if (!row) return { state: 'unavailable' };
  if (row.active_attempt_id && (row.deleted_at !== null || row.status !== 'published')) {
    return { state: 'resume', attemptId: row.active_attempt_id };
  }
  if (row.deleted_at !== null || row.status !== 'published') return row.last_attempt_id
    ? { state: 'finished', attemptId: row.last_attempt_id } : { state: 'unavailable' };
  await sql.query(
    `insert into faculty_module_opens (module_id, student_user_id)
     select id, $2::uuid from faculty_modules
     where id = $1::uuid and status = 'published' and deleted_at is null
     on conflict do nothing`,
    [row.id, studentId]
  );
  const now = new Date(row.server_now).getTime();
  const opens = new Date(row.opens_at).getTime();
  const closes = new Date(row.closes_at).getTime();
  if (now < opens) return { state: 'upcoming', opensAt: new Date(row.opens_at).toISOString() };
  if (now >= closes) return row.active_attempt_id
    ? { state: 'resume', attemptId: row.active_attempt_id }
    : { state: 'closed', lastAttemptId: row.last_attempt_id };
  return {
    state: 'open', title: row.title, description: row.description,
    instructions: row.instructions, questionCount: row.question_count,
    durationSeconds: row.duration_seconds, maxAttempts: row.max_attempts,
    attemptsUsed: row.attempts_used, activeAttemptId: row.active_attempt_id,
    lastAttemptId: row.last_attempt_id, correctPoints: row.correct_points,
    wrongPoints: row.wrong_points, blankPoints: row.blank_points,
    allowReview: row.allow_review, opensAt: new Date(row.opens_at).toISOString(),
    closesAt: new Date(row.closes_at).toISOString(),
  };
}
