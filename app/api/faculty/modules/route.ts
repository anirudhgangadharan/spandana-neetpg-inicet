import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { listOwnedModules } from '@/lib/db/facultyModules';
import { createFacultyDraft } from '@/lib/db/facultyModuleBuilder';
import { parseTitle } from '@/lib/faculty/moduleInput';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { facultyJson, facultyNoStore, facultyRouteError } from '@/lib/api/facultyModuleRoutes';

export async function GET(request: Request): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Forbidden' }, { status: 403, headers: facultyNoStore });
  const rawPage = new URL(request.url).searchParams.get('page') ?? '1';
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    return NextResponse.json({ message: 'Invalid page.' }, { status: 400, headers: facultyNoStore });
  }
  const modules = await listOwnedModules(actor.userId, (page - 1) * 50, 51);
  return NextResponse.json({ modules: modules.slice(0, 50), page, hasNext: modules.length > 50 }, { headers: facultyNoStore });
}

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Forbidden' }, { status: 403, headers: facultyNoStore });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: facultyNoStore });
  }
  try {
    const body = await facultyJson(request);
    const title = parseTitle(typeof body === 'object' && body !== null && 'title' in body ? body.title : null);
    const id = await createFacultyDraft(actor.userId, title);
    return NextResponse.json({ id }, { status: 201, headers: facultyNoStore });
  } catch (error) {
    return facultyRouteError(error);
  }
}
