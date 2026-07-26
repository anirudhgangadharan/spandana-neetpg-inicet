/**
 * GET /api/session/plan?seed=…&count=…&subject=…&topic=…
 *
 * Returns a deterministic, seeded question-id sequence (§7). The same seed and
 * the same filters always produce the same sequence, which is what makes an exam
 * session reproducible, resumable after a refresh, and testable.
 *
 * Only ids are returned. The client then fetches question windows of at most 200
 * (§3.1), so a 500-question exam never puts 500 questions in browser memory.
 */

import type { NextRequest } from 'next/server';
import { badRequest, ok, readInt, withCorpus } from '@/lib/api/respond';
import { MAX_SESSION_SIZE, planSession } from '@/lib/db/queries';
import { filtersFromParams } from '../../questions/route';

export function GET(request: NextRequest): ReturnType<typeof withCorpus> {
  return withCorpus(() => {
    const params = request.nextUrl.searchParams;

    const seed = params.get('seed');
    if (seed === null || seed.length === 0) return badRequest('seed is required');
    if (seed.length > 128) return badRequest('seed is too long');

    const count = readInt(params, 'count', 20);
    if (count < 1) return badRequest('count must be at least 1');
    if (count > MAX_SESSION_SIZE) return badRequest(`count must not exceed ${MAX_SESSION_SIZE}`);

    const plan = planSession({
      filters: filtersFromParams(params),
      count,
      seed,
      shuffle: params.get('shuffle') !== '0',
    });

    if (plan.ids.length === 0) {
      return badRequest('No questions match those filters.');
    }
    return ok(plan);
  });
}
