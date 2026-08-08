/**
 * Aggregate analytics for the /insights page (accounts plan trackers 2-5).
 * Pure reads against the append-only attempt_events log — nothing here
 * writes, and nothing here is cached: at this project's scale, plain SQL
 * window functions are fast enough that a materialized stats table would be
 * premature (revisit only if this route is ever actually slow).
 */
import { sql } from './userClient';

/** Below this many distinct users' worth of data for a subject, a
 *  percentile is more noise than signal — withheld rather than shown. */
const MIN_SUBJECT_SAMPLE = 20;
const MIN_TOPIC_ATTEMPTS = 3;
const MAX_WEAK_TOPICS = 5;

export interface SubjectInsight {
  readonly subject: string;
  readonly yourAccuracy: number;
  readonly yourAvgDurationMs: number;
  readonly accuracyPercentile: number;
  readonly speedPercentile: number;
  readonly sampleSizeOk: boolean;
}

interface SubjectInsightRow {
  subject: string;
  accuracy: number;
  avg_duration_ms: number;
  accuracy_percentile: number;
  speed_percentile: number;
  subject_sample_size: number;
}

/**
 * One row per subject the user has graded attempts in. `accuracy_percentile`
 * and `speed_percentile` are computed across EVERY user's per-subject
 * accuracy/avg-duration (percent_rank, 0-1) — a value near 1 means "better
 * than nearly everyone," matching how the number reads to the user.
 */
export async function getSubjectInsights(userId: string): Promise<SubjectInsight[]> {
  const rows = (await sql.query(
    `
    with latest as (
      select distinct on (user_id, question_id)
        user_id, question_id, subject, verdict, duration_ms
      from attempt_events
      order by user_id, question_id, attempted_at desc
    ),
    per_user_subject as (
      select
        user_id,
        subject,
        count(*) filter (where verdict in ('correct', 'incorrect')) as graded,
        count(*) filter (where verdict = 'correct') as correct,
        avg(duration_ms) as avg_duration_ms
      from latest
      group by user_id, subject
    ),
    ranked as (
      select
        user_id,
        subject,
        (correct::float / nullif(graded, 0)) as accuracy,
        avg_duration_ms,
        percent_rank() over (
          partition by subject order by (correct::float / nullif(graded, 0)) asc
        ) as accuracy_percentile,
        percent_rank() over (
          partition by subject order by avg_duration_ms desc
        ) as speed_percentile,
        count(*) over (partition by subject) as subject_sample_size
      from per_user_subject
      where graded > 0
    )
    select subject, accuracy, avg_duration_ms, accuracy_percentile, speed_percentile, subject_sample_size
    from ranked
    where user_id = $1
    order by subject
    `,
    [userId]
  )) as SubjectInsightRow[];

  return rows.map((r) => ({
    subject: r.subject,
    yourAccuracy: r.accuracy,
    yourAvgDurationMs: Math.round(r.avg_duration_ms),
    accuracyPercentile: r.accuracy_percentile,
    speedPercentile: r.speed_percentile,
    sampleSizeOk: r.subject_sample_size >= MIN_SUBJECT_SAMPLE,
  }));
}

export interface WeakTopic {
  readonly topic: string;
  readonly accuracy: number;
  readonly attempts: number;
}

/** The user's own weakest topics — no cross-user comparison, so no sample-
 *  size gate against other users, only a floor on their own attempt count
 *  (one wrong answer isn't "your weakest topic"). */
export async function getWeakestTopics(userId: string): Promise<WeakTopic[]> {
  const rows = (await sql.query(
    `
    with latest as (
      select distinct on (question_id)
        question_id, topic, verdict
      from attempt_events
      where user_id = $1 and topic is not null
      order by question_id, attempted_at desc
    )
    select
      topic,
      count(*) filter (where verdict in ('correct', 'incorrect')) as graded,
      count(*) filter (where verdict = 'correct') as correct
    from latest
    group by topic
    having count(*) filter (where verdict in ('correct', 'incorrect')) >= $2
    order by
      (count(*) filter (where verdict = 'correct'))::float
        / nullif(count(*) filter (where verdict in ('correct', 'incorrect')), 0) asc
    limit $3
    `,
    [userId, MIN_TOPIC_ATTEMPTS, MAX_WEAK_TOPICS]
  )) as { topic: string; graded: number; correct: number }[];

  return rows.map((r) => ({ topic: r.topic, accuracy: r.correct / r.graded, attempts: r.graded }));
}

/** Bookmarked questions whose most recent attempt is still wrong — the
 *  revisit nudge (tracker 5). */
export async function countUnrevisitedWrongBookmarks(userId: string): Promise<number> {
  const rows = (await sql.query(
    `
    with latest as (
      select distinct on (question_id) question_id, verdict
      from attempt_events
      where user_id = $1
      order by question_id, attempted_at desc
    )
    select count(*)::int as n
    from bookmarks b
    join latest l on l.question_id = b.question_id
    where b.user_id = $1 and l.verdict = 'incorrect'
    `,
    [userId]
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}
