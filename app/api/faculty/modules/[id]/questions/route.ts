import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { facultyJson, facultyNoStore, facultyRouteError, facultyUuid } from '@/lib/api/facultyModuleRoutes';
import { parseSelection } from '@/lib/faculty/moduleInput';
import { replaceFacultyQuestions } from '@/lib/db/facultyModuleBuilder';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id } = await context.params;
  if (!facultyUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: facultyNoStore });
  try {
    await replaceFacultyQuestions(actor.userId, id, parseSelection(await facultyJson(request)));
    return NextResponse.json({ module: await getOwnedModuleDetail(actor.userId, id) }, { headers: facultyNoStore });
  } catch (error) {
    return facultyRouteError(error);
  }
}
