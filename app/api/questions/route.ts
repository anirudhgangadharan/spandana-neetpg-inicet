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
import type { QuestionSource, Split } from '@/types';

const VALID_SPLITS: readonly string[] = ['train', 'validation'];
const VALID_SOURCES: readonly string[] = ['medmcqa', 'usmle'];

/**
 * Shared by `/api/questions`, `/api/search`, and `/api/session/plan` (all
 * import this function), so this is the single point that decides the
 * default question bank.
 *
 * Absence of `?source=` defaults to `['medmcqa']` — NOT "every source" — so
 * every existing link, bookmark, or API caller keeps seeing exactly what it
 * saw before USMLE existed. An explicit `?source=usmle` (or
 * `&source=medmcqa&source=usmle`) opts in.
 */
export function filtersFromParams(params: URLSearchParams): QuestionFilters {
  const requestedSources = readList(params, 'source').filter((s): s is QuestionSource => VALID_SOURCES.includes(s));
  return {
    sources: params.has('source') ? requestedSources : ['medmcqa'],
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
