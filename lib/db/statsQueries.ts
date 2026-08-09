/**
 * Lightweight, always-visible stats (streak + coverage) — distinct from
 * lib/db/insightsQueries.ts, which powers the deeper /insights page.
 * Cheap enough to call on every page load, which is the point: the
 * Investment-stage habit mechanic only works if it's visible constantly,
 * not buried in a report you have to go looking for.
 */
import { sql } from './userClient';

export interface UserStats {
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly streakFreezes: number;
  /** Distinct questions ever attempted — paired client-side with the
   *  corpus's total session-eligible count (already known via facets,
   *  no need to duplicate that number here). */
  readonly questionsCovered: number;
  /** Last-used session config, for the one-tap "Continue practicing" path.
   *  Folded into this same read rather than a separate endpoint — both are
   *  needed on the same page load. */
  readonly lastSessionConfig: unknown;
}

interface StatsRow {
  current_streak: number;
  longest_streak: number;
  streak_freezes: number;
  questions_covered: number;
  last_session_config: unknown;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const rows = (await sql.query(
    `select
       u.current_streak,
       u.longest_streak,
       u.streak_freezes,
       u.last_session_config,
       (select count(distinct question_id) from attempt_events where user_id = $1)::int as questions_covered
     from users u
     where u.id = $1`,
    [userId]
  )) as StatsRow[];
  const row = rows[0];
  if (row === undefined) throw new Error('getUserStats: user not found');
  return {
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    streakFreezes: row.streak_freezes,
    questionsCovered: row.questions_covered,
    lastSessionConfig: row.last_session_config,
  };
}

export async function saveLastSessionConfig(userId: string, config: unknown): Promise<void> {
  await sql.query('update users set last_session_config = $2 where id = $1', [userId, JSON.stringify(config)]);
}
