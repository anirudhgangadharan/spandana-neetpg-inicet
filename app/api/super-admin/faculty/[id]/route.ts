import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { changeFacultyStatus, listFacultyGrants } from '@/lib/db/facultyGrants';

const noStore = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function change(request: Request, context: { params: Promise<{ id: string }> }, status: 'disabled' | 'removed') {
  if (!(await requireRole('super_admin'))) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403, headers: noStore });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: noStore });
  }
  const { id } = await context.params;
  if (!uuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: noStore });
  if (!(await changeFacultyStatus(id, status))) {
    return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: noStore });
  }
  return NextResponse.json({ faculty: await listFacultyGrants() }, { headers: noStore });
}

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return change(request, context, 'disabled');
}

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  return change(request, context, 'removed');
}
