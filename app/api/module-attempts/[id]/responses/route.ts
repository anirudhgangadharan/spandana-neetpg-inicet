import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentJson, studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { saveStudentResponse } from '@/lib/db/moduleAttempts';
import { moduleUuid, parseResponseSave } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('student');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const { id } = await context.params;
  if (!moduleUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    const input = parseResponseSave(await studentJson(request));
    const saved = await saveStudentResponse(actor.userId, id, input);
    if (saved.expired) {
      return NextResponse.json({ message: 'This attempt has finished. The late answer was not saved.' },
        { status: 409, headers: studentNoStore });
    }
    return NextResponse.json(saved.response, { headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
