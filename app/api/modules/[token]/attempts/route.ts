import { NextResponse } from 'next/server';
import { getGuestStudentId } from '@/lib/db/guestStudents';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { startStudentAttempt } from '@/lib/db/moduleAttempts';
import { moduleUuid } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const { token } = await context.params;
  if (!moduleUuid.test(token)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const studentId = await getGuestStudentId(token);
  if (!studentId) return NextResponse.json({ message: 'Enter your student details first.' }, { status: 401, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    const started = await startStudentAttempt(token, studentId);
    return NextResponse.json(started, { status: started.resumed ? 200 : 201, headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
