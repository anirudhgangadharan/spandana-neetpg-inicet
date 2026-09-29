import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { facultyJson, facultyNoStore, facultyRouteError, facultyUuid } from '@/lib/api/facultyModuleRoutes';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';
import { parseCorrection, saveQuestionCorrection } from '@/lib/db/saveQuestionCorrection';
import { getQuestionById } from '@/lib/db/queries';
import { moduleSnapshotFromQuestion } from '@/lib/core/question';
import { sql } from '@/lib/db/userClient';

type Context = { params: Promise<{ id: string; questionId: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id, questionId } = await context.params;
  if (!facultyUuid.test(id) || questionId.length < 1 || questionId.length > 200) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  }
  const ownedDraft = await getOwnedModuleDetail(actor.userId, id);
  if (!ownedDraft || ownedDraft.status !== 'draft' || !ownedDraft.selectedQuestions.some((question) => question.id === questionId)) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  }
  const source = getQuestionById(questionId);
  if (!source) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const history = await sql.query(
    `select version, reason, created_at, reverted_from from question_corrections
     where question_id = $1 order by version desc limit 20`, [questionId]
  ) as { version: number; reason: string; created_at: string | Date; reverted_from: number | null }[];
  const latest = await sql.query(
    `select version, stem, options, answer_index, explanation from question_corrections
     where question_id = $1 order by version desc limit 1`, [questionId]
  ) as { version: number; stem: string; options: string[]; answer_index: number; explanation: string | null }[];
  const base = moduleSnapshotFromQuestion(source);
  return NextResponse.json({ source: { stem: base.stem, options: base.options,
    correctOption: base.answer + 1, explanation: base.explanation },
    current: latest[0] ? { version: latest[0].version, stem: latest[0].stem,
      options: latest[0].options, correctOption: latest[0].answer_index + 1,
      explanation: latest[0].explanation } : null, history }, { headers: facultyNoStore });
}

export async function PUT(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id, questionId } = await context.params;
  if (!facultyUuid.test(id) || questionId.length < 1 || questionId.length > 200) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: facultyNoStore });
  try {
    await saveQuestionCorrection(actor.userId, id, questionId, parseCorrection(await facultyJson(request)));
    return NextResponse.json({ module: await getOwnedModuleDetail(actor.userId, id) }, { headers: facultyNoStore });
  } catch (error) {
    return facultyRouteError(error);
  }
}
