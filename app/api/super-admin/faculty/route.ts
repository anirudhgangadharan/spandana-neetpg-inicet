import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { activateFaculty, FacultyLimitError, listFacultyGrants } from '@/lib/db/facultyGrants';
import { JsonBodyError, readBoundedJson } from '@/lib/api/jsonBody';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(): Promise<NextResponse> {
  if (!(await requireRole('super_admin'))) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403, headers: noStore });
  }
  return NextResponse.json({ faculty: await listFacultyGrants() }, { headers: noStore });
}

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireRole('super_admin');
  if (!actor) return NextResponse.json({ message: 'Forbidden' }, { status: 403, headers: noStore });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: noStore });
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, 1024);
  } catch (error) {
    if (error instanceof JsonBodyError) {
      return NextResponse.json({ message: error.message }, { status: error.status, headers: noStore });
    }
    throw error;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'email')) {
    return NextResponse.json({ message: 'Enter one faculty email.' }, { status: 400, headers: noStore });
  }
  const email = 'email' in body ? body.email : null;
  if (typeof email !== 'string' || email.length > 254 || email.trim().toLowerCase() === actor.email) {
    return NextResponse.json({ message: 'Enter a faculty email other than your own.' }, { status: 400, headers: noStore });
  }
  try {
    await activateFaculty(email, actor.userId);
  } catch (error) {
    if (error instanceof FacultyLimitError) {
      return NextResponse.json({ message: error.message }, { status: 409, headers: noStore });
    }
    if (error instanceof Error && error.message === 'Invalid email address.') {
      return NextResponse.json({ message: error.message }, { status: 400, headers: noStore });
    }
    throw error;
  }
  return NextResponse.json({ faculty: await listFacultyGrants() }, { status: 201, headers: noStore });
}
