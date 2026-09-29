import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { studentJson, studentNoStore, studentRouteError } from '@/lib/api/studentModuleRoutes';
import { enrollGuest, parseGuestIdentity, setGuestCookie } from '@/lib/db/guestStudents';
import { moduleUuid } from '@/lib/student/moduleInput';

type Context = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: Context): Promise<NextResponse> {
  const { token } = await context.params;
  if (!moduleUuid.test(token)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: studentNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: studentNoStore });
  try {
    const details = parseGuestIdentity(await studentJson(request));
    await setGuestCookie(await enrollGuest(token, details), token);
    return NextResponse.json({ registered: true }, { status: 201, headers: studentNoStore });
  } catch (error) {
    return studentRouteError(error);
  }
}
