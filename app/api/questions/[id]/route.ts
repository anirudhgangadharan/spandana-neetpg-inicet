/** GET /api/questions/:id — a single question, for deep links and provenance (I5). */

import type { NextRequest } from 'next/server';
import { notFound, ok, withCorpus } from '@/lib/api/respond';
import { getQuestionById } from '@/lib/db/queries';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<ReturnType<typeof withCorpus>> {
  const { id } = await context.params;
  return withCorpus(() => {
    const question = getQuestionById(id);
    if (question === null) return notFound(`No question with id "${id}" in the corpus.`);
    return ok({ question });
  });
}
