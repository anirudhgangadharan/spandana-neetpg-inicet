import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';
import { deleteFacultyModule, saveFacultyDraftSettings } from '@/lib/db/facultyModuleBuilder';
import { parseDraftSettings, parseRevision } from '@/lib/faculty/moduleInput';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { facultyJson, facultyNoStore, facultyRouteError, facultyUuid } from '@/lib/api/facultyModuleRoutes';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id } = await context.params;
  if (!facultyUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const ownedModule = await getOwnedModuleDetail(actor.userId, id);
  if (!ownedModule) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  return NextResponse.json({ module: ownedModule }, { headers: facultyNoStore });
}

export async function PATCH(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id } = await context.params;
  if (!facultyUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: facultyNoStore });
  try {
    const { revision, settings } = parseDraftSettings(await facultyJson(request));
    await saveFacultyDraftSettings(actor.userId, id, revision, settings);
    return NextResponse.json({ module: await getOwnedModuleDetail(actor.userId, id) }, { headers: facultyNoStore });
  } catch (error) {
    return facultyRouteError(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id } = await context.params;
  if (!facultyUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers: facultyNoStore });
  try {
    const body = await facultyJson(request);
    const revision = parseRevision(typeof body === 'object' && body !== null && 'revision' in body ? body.revision : null);
    await deleteFacultyModule(actor.userId, id, revision);
    return NextResponse.json({ deleted: true }, { headers: facultyNoStore });
  } catch (error) {
    return facultyRouteError(error);
  }
}
