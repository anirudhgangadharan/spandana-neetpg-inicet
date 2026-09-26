import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentJson, studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { recordStudentActivity } from '@/lib/db/moduleAttempts';
import { moduleUuid, parseActivity } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('student');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const { id } = await context.params;
  if (!moduleUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    const { position } = parseActivity(await studentJson(request));
    const result = await recordStudentActivity(actor.userId, id, position);
    if (result.expired) {
      return NextResponse.json({ message: 'This attempt has finished.' }, { status: 409, headers: studentNoStore });
    }
    return NextResponse.json({ observed: true }, { headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
