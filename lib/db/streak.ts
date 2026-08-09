/**
 * Streak computation (habit-formation plan, D-Duolingo: loss aversion is
 * the load-bearing mechanic — a streak only means something if the rule
 * for keeping it is dead simple and never silently changes).
 *
 * Rule: answered >=1 question today keeps the streak alive. No XP, no
 * weighting. Called from the /api/sync POST path whenever at least one new
 * attempt event actually lands that call.
 *
 * Read-then-write rather than one atomic SQL statement: the earn-a-freeze-
 * every-N-days rule is far easier to get right as plain JS, and the tiny
 * race window (this one user's own two requests landing in the same
 * instant) isn't a real risk at this project's scale — the same pragmatic
 * tradeoff middleware.ts's rate limiter already documents for itself.
 */
import { sql } from './userClient';

const FREEZE_EVERY_N_DAYS = 10;

export interface StreakState {
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly streakFreezes: number;
}

interface UserStreakRow {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  streak_freezes: number;
}

function daysBetween(laterIso: string, earlierIso: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${laterIso}T00:00:00Z`) - Date.parse(`${earlierIso}T00:00:00Z`)) / msPerDay);
}

/**
 * Updates and returns the user's streak state. Idempotent within a single
 * calendar day — calling it twice on the same day is a no-op the second
 * time, so callers don't need to guard against double-counting.
 *
 * Known limitation: "today" is the server's UTC calendar date, not the
 * user's local one. A streak can rarely appear to skip or double-count for
 * users far from UTC right around midnight there — acceptable for a
 * personal project, worth revisiting only if it's ever actually reported.
 */
export async function updateStreak(userId: string): Promise<StreakState> {
  const rows = (await sql.query(
    'select current_streak, longest_streak, last_active_date, streak_freezes from users where id = $1',
    [userId]
  )) as UserStreakRow[];
  const row = rows[0];
  if (row === undefined) throw new Error('updateStreak: user not found');

  const today = new Date().toISOString().slice(0, 10);

  if (row.last_active_date === today) {
    return { currentStreak: row.current_streak, longestStreak: row.longest_streak, streakFreezes: row.streak_freezes };
  }

  let currentStreak: number;
  let streakFreezes = row.streak_freezes;

  if (row.last_active_date === null) {
    currentStreak = 1;
  } else {
    const gap = daysBetween(today, row.last_active_date);
    if (gap === 1) {
      currentStreak = row.current_streak + 1;
    } else if (gap === 2 && streakFreezes > 0) {
      // One missed day, covered by a banked freeze: the streak continues
      // as though the gap never happened, rather than resetting to 1 —
      // this is what keeps loss aversion sustainable instead of just
      // punishing the first slip after weeks of investment.
      currentStreak = row.current_streak + 1;
      streakFreezes -= 1;
    } else {
      currentStreak = 1;
    }
  }

  if (currentStreak % FREEZE_EVERY_N_DAYS === 0) {
    streakFreezes += 1;
  }

  const longestStreak = Math.max(row.longest_streak, currentStreak);

  await sql.query(
    'update users set current_streak = $2, longest_streak = $3, streak_freezes = $4, last_active_date = $5 where id = $1',
    [userId, currentStreak, longestStreak, streakFreezes, today]
  );

  return { currentStreak, longestStreak, streakFreezes };
}
