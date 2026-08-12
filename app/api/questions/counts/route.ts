/**
 * GET /api/questions/counts?source=&subject=&topic=&flagged=
 *
 * Live counts for the session-mode selector in SessionSetup: how many
 * questions in the current filter selection are New/Incorrect/Correct/
 * Attempted/Marked, alongside the total. Requires a signed-in user (always true in
 * practice behind the hard gate) — every count but `total` is per-account.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { badRequest, withCorpusAsync } from '@/lib/api/respond';
import { countQuestions } from '@/lib/db/queries';
import {
  getAttemptedQuestionIds,
  getCorrectQuestionIds,
  getIncorrectQuestionIds,
  getMarkedQuestionIds,
} from '@/lib/db/questionStateQueries';
import { filtersFromParams } from '../../questions/route';

export function GET(request: NextRequest): ReturnType<typeof withCorpusAsync> {
  return withCorpusAsync(async () => {
    const session = await auth();
    if (!session?.user) return badRequest('Sign in to see question counts.');

    const params = request.nextUrl.searchParams;
    const filters = filtersFromParams(params);
    const subjects = filters.subjects ?? [];
    const topics = filters.topics ?? [];

    // Known minor gap: `total` also respects onlyFlagged/source, but the
    // Neon-side counts below only scope by subject/topic (attempt_events
    // has no flag data). Combining "only flagged" with a mode filter can
    // therefore make `new` slightly imprecise — session PLANNING stays
    // correct regardless (buildWhere still ANDs the real flag condition
    // in), only this display count can be a little off in that narrow
    // combination. Not worth the complexity to close until it's reported.
    const total = countQuestions(filters);
    const [attempted, incorrect, correct, marked] = await Promise.all([
      getAttemptedQuestionIds(session.user.id, subjects, topics),
      getIncorrectQuestionIds(session.user.id, subjects, topics),
      getCorrectQuestionIds(session.user.id, subjects, topics),
      getMarkedQuestionIds(session.user.id, subjects, topics),
    ]);

    return NextResponse.json(
      {
        total,
        new: Math.max(0, total - attempted.length),
        incorrect: incorrect.length,
        correct: correct.length,
        attempted: attempted.length,
        marked: marked.length,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  });
}
