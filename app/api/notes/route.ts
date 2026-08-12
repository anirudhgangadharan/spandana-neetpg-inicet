/**
 * GET /api/notes?questionId=<id>
 *
 * Public read (any signed-in user — every page route already requires
 * sign-in via middleware.ts) of the notes visible on one question: its own
 * question-scoped notes plus any concept notes for its subject/topic.
 *
 * subject/topic are resolved from the corpus by questionId, never trusted
 * from a query param — same posture as app/api/sync/route.ts.
 */
import { NextResponse } from 'next/server';
import { getQuestionById } from '@/lib/db/queries';
import { getNotesForQuestion } from '@/lib/db/notesQueries';

export async function GET(request: Request): Promise<NextResponse> {
  const questionId = new URL(request.url).searchParams.get('questionId');
  if (questionId === null || questionId.length === 0) {
    return NextResponse.json({ message: 'questionId is required.' }, { status: 400 });
  }

  const question = getQuestionById(questionId);
  if (question === null) return NextResponse.json({ notes: [] });

  const notes = await getNotesForQuestion(questionId, question.subject, question.topic);
  return NextResponse.json({ notes });
}
