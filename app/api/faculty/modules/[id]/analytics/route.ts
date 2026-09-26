import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { getOwnedModuleAnalytics } from '@/lib/db/facultyAnalytics';
import { facultyNoStore, facultyUuid } from '@/lib/api/facultyModuleRoutes';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<NextResponse> {
  const actor = await requireRole('faculty');
  if (!actor) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const { id } = await context.params;
  if (!facultyUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  const params = new URL(request.url).searchParams;
  const page = Number(params.get('page') ?? '1');
  const search = (params.get('q') ?? '').trim();
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || search.length > 120) {
    return NextResponse.json({ message: 'Invalid analytics query.' }, { status: 400, headers: facultyNoStore });
  }
  const analytics = await getOwnedModuleAnalytics(actor.userId, id, page, search);
  if (!analytics) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers: facultyNoStore });
  return NextResponse.json({ analytics }, { headers: facultyNoStore });
}
