import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { submitStudentAttempt } from '@/lib/db/moduleAttempts';
import { moduleUuid } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('student');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const { id } = await context.params;
  if (!moduleUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    return NextResponse.json(await submitStudentAttempt(id, actor.userId), { headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
