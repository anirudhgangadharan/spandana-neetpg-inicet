/**
 * GET /api/questions
 *
 *   ?ids=a,b,c                       → those questions, in the order requested
 *   ?subject=…&topic=…&cursor=…&limit=…  → a filtered page
 *
 * Either form returns at most `MAX_WINDOW` (200) questions, which is the
 * mechanism behind §3.1's rule that the client never holds more than the current
 * window in memory.
 */

import type { NextRequest } from 'next/server';
import { badRequest, ok, readBool, readInt, readList, withCorpus } from '@/lib/api/respond';
import {
  DEFAULT_PAGE_SIZE,
  MAX_WINDOW,
  getQuestionsByIds,
  listQuestions,
  type QuestionFilters,
} from '@/lib/db/queries';
import type { Split } from '@/types';

const VALID_SPLITS: readonly string[] = ['train', 'validation'];

export function filtersFromParams(params: URLSearchParams): QuestionFilters {
  return {
    subjects: readList(params, 'subject'),
    topics: readList(params, 'topic'),
    splits: readList(params, 'split').filter((s): s is Split => VALID_SPLITS.includes(s)),
    onlyFlagged: readBool(params, 'flagged'),
    // Duplicates and conflicting-answer records are excluded unless explicitly
    // requested (H6, H9). Browsing may include them; sessions may not.
    sessionEligibleOnly: !readBool(params, 'includeExcluded'),
  };
}

export function GET(request: NextRequest): ReturnType<typeof withCorpus> {
  return withCorpus(() => {
    const params = request.nextUrl.searchParams;

    const ids = readList(params, 'ids');
    if (ids.length > 0) {
      if (ids.length > MAX_WINDOW) {
        return badRequest(`Requested ${ids.length} ids; the maximum window is ${MAX_WINDOW}.`);
      }
      return ok({ questions: getQuestionsByIds(ids) });
    }

    const limit = readInt(params, 'limit', DEFAULT_PAGE_SIZE);
    const cursorRaw = params.get('cursor');
    const cursor = cursorRaw === null ? null : Number.parseInt(cursorRaw, 10);
    if (cursor !== null && !Number.isFinite(cursor)) return badRequest('cursor must be an integer');

    return ok(listQuestions(filtersFromParams(params), cursor, limit));
  });
}
