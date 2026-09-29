/** GET /api/questions/:id — a single question, for deep links and provenance (I5). */

import type { NextRequest } from 'next/server';
import { notFound, ok, withCorpusAsync } from '@/lib/api/respond';
import { getQuestionById } from '@/lib/db/queries';
import { effectiveQuestions } from '@/lib/db/questionCorrections';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Awaited<ReturnType<typeof withCorpusAsync>>> {
  const { id } = await context.params;
  return withCorpusAsync(async () => {
    const question = getQuestionById(id);
    if (question === null) return notFound(`No question with id "${id}" in the corpus.`);
    const resolved = await effectiveQuestions([question]);
    return ok({ question: resolved.questions[0] }, false);
  });
}
