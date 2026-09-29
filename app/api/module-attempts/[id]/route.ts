import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getGuestStudentId } from '@/lib/db/guestStudents';
import { studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { getStudentAttempt } from '@/lib/db/moduleAttempts';
import { moduleUuid } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const { id } = await context.params;
  if (!moduleUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const studentId = await getGuestStudentId(undefined, id) ?? (await requireRole('student'))?.userId;
  if (!studentId) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  try {
    return NextResponse.json(await getStudentAttempt(id, studentId), { headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
