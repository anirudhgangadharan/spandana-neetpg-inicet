/**
 * GET /api/search?q=…&subject=…&limit=…
 *
 * FTS5 full-text search over stems, options and explanations, BM25-ranked with
 * the stem weighted highest. Budget: p95 < 150 ms (§11).
 */

import type { NextRequest } from 'next/server';
import { ok, readInt, withCorpusAsync } from '@/lib/api/respond';
import { MAX_SEARCH_RESULTS, listQuestions, searchQuestions } from '@/lib/db/queries';
import { effectiveQuestions } from '@/lib/db/questionCorrections';
import { sql } from '@/lib/db/userClient';
import { filtersFromParams } from '../questions/route';

export function GET(request: NextRequest): ReturnType<typeof withCorpusAsync> {
  return withCorpusAsync(async () => {
    const params = request.nextUrl.searchParams;
    const q = (params.get('q') ?? '').trim();
    if (q.length === 0) return ok({ query: '', hits: [], tookMs: 0 });

    const started = performance.now();
    const filters = filtersFromParams(params);
    const limit = Math.min(50, Math.max(1, readInt(params, 'limit', MAX_SEARCH_RESULTS)));
    const hits = searchQuestions(q, filters, limit);
    // The SQLite FTS index intentionally remains immutable. Search the small
    // latest-correction set separately so newly corrected terms are findable.
    const correctedIds = q.length >= 3 ? await sql.query(
      `select question_id from (
         select distinct on (question_id) question_id, stem, options, explanation
         from question_corrections order by question_id, version desc
       ) latest
       where stem ilike '%' || $1 || '%' or options::text ilike '%' || $1 || '%'
         or coalesce(explanation, '') ilike '%' || $1 || '%'
       limit $2`, [q.slice(0, 120), limit]
    ) as { question_id: string }[] : [];
    const extra = correctedIds.length ? listQuestions({ ...filters, includeIds: correctedIds.map((row) => row.question_id) }, null, limit).questions : [];
    const byId = new Map(extra.map((question) => [question.id, { question, score: 0 }]));
    for (const hit of hits) if (!byId.has(hit.question.id)) byId.set(hit.question.id, hit);
    const combined = [...byId.values()].slice(0, limit);
    const resolved = await effectiveQuestions(combined.map((hit) => hit.question));
    const tookMs = Math.round((performance.now() - started) * 100) / 100;

    return ok({ query: q, hits: combined.map((hit, index) => ({ ...hit, question: resolved.questions[index] })), tookMs }, false);
  });
}
