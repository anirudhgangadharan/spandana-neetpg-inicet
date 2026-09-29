import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getGuestStudentId } from '@/lib/db/guestStudents';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentJson, studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { submitStudentAttempt } from '@/lib/db/moduleAttempts';
import { moduleUuid, parseFinalAnswers } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!moduleUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const guestId = await getGuestStudentId(undefined, id);
  const studentId = guestId ?? (await requireRole('student'))?.userId;
  if (!studentId) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    const answers = request.body ? parseFinalAnswers(await studentJson(request, 8192)) : undefined;
    return NextResponse.json(await submitStudentAttempt(id, studentId, answers), { headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
