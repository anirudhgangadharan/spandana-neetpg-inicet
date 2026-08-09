/**
 * Per-user question-state queries (session-state-aware planning plan).
 * Resolves the New/Incorrect/Marked/All session modes into explicit id
 * lists — used both for the live counts shown in SessionSetup and as the
 * include/exclude constraint handed to lib/db/queries.ts's planSession().
 *
 * Each function is scoped to the SAME subject/topic filters the user has
 * selected, so "23 incorrect" means 23 incorrect IN THE SELECTED SUBJECTS,
 * not a count across the user's entire history.
 */
import { sql } from './userClient';

function scopeClause(subjects: readonly string[], topics: readonly string[]): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (subjects.length > 0) {
    params.push(subjects);
    conditions.push(`subject = any($${params.length + 1})`);
  }
  if (topics.length > 0) {
    params.push(topics);
    conditions.push(`topic = any($${params.length + 1})`);
  }
  return { clause: conditions.length > 0 ? `and ${conditions.join(' and ')}` : '', params };
}

/** All question ids this user has ever attempted — the EXCLUDE list for
 *  "New" mode. */
export async function getAttemptedQuestionIds(
  userId: string,
  subjects: readonly string[],
  topics: readonly string[]
): Promise<string[]> {
  const { clause, params } = scopeClause(subjects, topics);
  const rows = (await sql.query(
    `select distinct question_id from attempt_events where user_id = $1 ${clause}`,
    [userId, ...params]
  )) as { question_id: string }[];
  return rows.map((r) => r.question_id);
}

async function getLatestVerdictQuestionIds(
  userId: string,
  verdict: 'incorrect' | 'correct',
  subjects: readonly string[],
  topics: readonly string[]
): Promise<string[]> {
  const { clause, params } = scopeClause(subjects, topics);
  const rows = (await sql.query(
    `select question_id from (
       select distinct on (question_id) question_id, verdict
       from attempt_events
       where user_id = $1 ${clause}
       order by question_id, attempted_at desc
     ) latest
     where verdict = $${params.length + 2}`,
    [userId, ...params, verdict]
  )) as { question_id: string }[];
  return rows.map((r) => r.question_id);
}

/** Question ids whose LATEST attempt is incorrect — the INCLUDE list for
 *  "Incorrect" mode. */
export function getIncorrectQuestionIds(
  userId: string,
  subjects: readonly string[],
  topics: readonly string[]
): Promise<string[]> {
  return getLatestVerdictQuestionIds(userId, 'incorrect', subjects, topics);
}

/** Question ids whose LATEST attempt is correct — shown as an informational
 *  count only; not currently a selectable session mode. */
export function getCorrectQuestionIds(
  userId: string,
  subjects: readonly string[],
  topics: readonly string[]
): Promise<string[]> {
  return getLatestVerdictQuestionIds(userId, 'correct', subjects, topics);
}

/** Bookmarked question ids — the INCLUDE list for "Marked" mode. */
export async function getMarkedQuestionIds(
  userId: string,
  subjects: readonly string[],
  topics: readonly string[]
): Promise<string[]> {
  const { clause, params } = scopeClause(subjects, topics);
  const rows = (await sql.query(`select question_id from bookmarks where user_id = $1 ${clause}`, [
    userId,
    ...params,
  ])) as { question_id: string }[];
  return rows.map((r) => r.question_id);
}
