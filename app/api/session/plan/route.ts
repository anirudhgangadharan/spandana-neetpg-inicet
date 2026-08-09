/**
 * GET /api/session/plan?seed=…&count=…&subject=…&topic=…&mode=…
 *
 * Returns a deterministic, seeded question-id sequence (§7). The same seed and
 * the same filters always produce the same sequence FOR A GIVEN SNAPSHOT of
 * the user's history — which is what makes an exam session reproducible and
 * resumable after a refresh, but see the `mode` note below for New/Incorrect/
 * Marked.
 *
 * `mode` (session-state-aware planning plan) — one of:
 *   all       — today's behaviour, unchanged: any question matching filters.
 *   new       — excludes every question this user has ever attempted.
 *   incorrect — restricted to questions whose latest attempt was wrong.
 *   marked    — restricted to this user's bookmarks.
 * Defaults to `all` when omitted, so this endpoint's behaviour for an
 * existing caller that never sends `mode` is byte-for-byte unchanged.
 * new/incorrect/marked require a signed-in user (always true in practice —
 * this route sits behind the hard login gate — but checked explicitly
 * rather than assumed).
 *
 * Only ids are returned. The client then fetches question windows of at most 200
 * (§3.1), so a 500-question exam never puts 500 questions in browser memory.
 */

import type { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { badRequest, ok, readInt, withCorpusAsync } from '@/lib/api/respond';
import { MAX_SESSION_SIZE, planSession, type QuestionFilters } from '@/lib/db/queries';
import { getAttemptedQuestionIds, getIncorrectQuestionIds, getMarkedQuestionIds } from '@/lib/db/questionStateQueries';
import { filtersFromParams } from '../../questions/route';

const VALID_MODES = ['all', 'new', 'incorrect', 'marked'] as const;
type SessionMode = (typeof VALID_MODES)[number];

export function GET(request: NextRequest): ReturnType<typeof withCorpusAsync> {
  return withCorpusAsync(async () => {
    const params = request.nextUrl.searchParams;

    const seed = params.get('seed');
    if (seed === null || seed.length === 0) return badRequest('seed is required');
    if (seed.length > 128) return badRequest('seed is too long');

    const count = readInt(params, 'count', 20);
    if (count < 1) return badRequest('count must be at least 1');
    if (count > MAX_SESSION_SIZE) return badRequest(`count must not exceed ${MAX_SESSION_SIZE}`);

    const rawMode = params.get('mode') ?? 'all';
    if (!VALID_MODES.includes(rawMode as SessionMode)) {
      return badRequest(`mode must be one of ${VALID_MODES.join(', ')}`);
    }
    const mode = rawMode as SessionMode;

    const baseFilters = filtersFromParams(params);
    let filters: QuestionFilters = baseFilters;

    if (mode !== 'all') {
      const session = await auth();
      if (!session?.user) return badRequest('Sign in to use this session mode.');
      const subjects = baseFilters.subjects ?? [];
      const topics = baseFilters.topics ?? [];

      if (mode === 'new') {
        const excludeIds = await getAttemptedQuestionIds(session.user.id, subjects, topics);
        filters = { ...baseFilters, excludeIds };
      } else if (mode === 'incorrect') {
        const includeIds = await getIncorrectQuestionIds(session.user.id, subjects, topics);
        filters = { ...baseFilters, includeIds };
      } else {
        const includeIds = await getMarkedQuestionIds(session.user.id, subjects, topics);
        filters = { ...baseFilters, includeIds };
      }
    }

    const plan = planSession({
      filters,
      count,
      seed,
      shuffle: params.get('shuffle') !== '0',
    });

    if (plan.ids.length === 0) {
      return badRequest('No questions match those filters.');
    }
    // Only `all` is a pure function of (seed, filters) — new/incorrect/marked
    // also depend on THIS user's history, so publicly caching the response
    // (today's default for this endpoint) would be a real cross-user leak
    // risk if this ever sits behind any shared cache.
    return ok(plan, mode === 'all');
  });
}
