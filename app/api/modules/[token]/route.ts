import { NextResponse } from 'next/server';
import { getGuestStudentId } from '@/lib/db/guestStudents';
import { getPublicModuleLanding, getStudentModuleLanding } from '@/lib/db/studentModules';
import { moduleUuid } from '@/lib/student/moduleInput';
import { studentNoStore } from '@/lib/api/studentModuleRoutes';

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const { token } = await context.params;
  if (!moduleUuid.test(token)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const guestId = await getGuestStudentId(token);
  const landing = guestId ? await getStudentModuleLanding(token, guestId) : await getPublicModuleLanding(token);
  if (landing.state === 'unavailable') {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  }
  return NextResponse.json(landing, { headers: studentNoStore });
}
