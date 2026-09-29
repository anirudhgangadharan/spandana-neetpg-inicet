import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentJson, studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { redeemGuestRecovery, setGuestCookie } from '@/lib/db/guestStudents';
import { moduleUuid, StudentModuleInputError } from '@/lib/student/moduleInput';

export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  if (!moduleUuid.test(token)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    const body = await studentJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'code') || typeof (body as Record<string, unknown>)['code'] !== 'string') {
      throw new StudentModuleInputError('Enter the recovery code given by your faculty member.');
    }
    await setGuestCookie(await redeemGuestRecovery(token, (body as { code: string }).code.trim()), token);
    return NextResponse.json({ recovered: true }, { headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
