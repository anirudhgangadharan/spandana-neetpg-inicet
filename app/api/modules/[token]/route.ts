import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getStudentModuleLanding } from '@/lib/db/studentModules';
import { moduleUuid } from '@/lib/student/moduleInput';
import { studentNoStore } from '@/lib/api/studentModuleRoutes';

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('student');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const { token } = await context.params;
  if (!moduleUuid.test(token)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  const landing = await getStudentModuleLanding(token, actor.userId);
  if (landing.state === 'unavailable') {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  }
  return NextResponse.json(landing, { headers: studentNoStore });
}
