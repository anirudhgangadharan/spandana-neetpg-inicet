/**
 * GET /api/search?q=…&subject=…&limit=…
 *
 * FTS5 full-text search over stems, options and explanations, BM25-ranked with
 * the stem weighted highest. Budget: p95 < 150 ms (§11).
 */

import type { NextRequest } from 'next/server';
import { ok, readInt, withCorpus } from '@/lib/api/respond';
import { MAX_SEARCH_RESULTS, searchQuestions } from '@/lib/db/queries';
import { filtersFromParams } from '../questions/route';

export function GET(request: NextRequest): ReturnType<typeof withCorpus> {
  return withCorpus(() => {
    const params = request.nextUrl.searchParams;
    const q = (params.get('q') ?? '').trim();
    if (q.length === 0) return ok({ query: '', hits: [], tookMs: 0 });

    const started = performance.now();
    const hits = searchQuestions(q, filtersFromParams(params), readInt(params, 'limit', MAX_SEARCH_RESULTS));
    const tookMs = Math.round((performance.now() - started) * 100) / 100;

    return ok({ query: q, hits, tookMs });
  });
}
