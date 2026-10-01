import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/roles';
import { isSameOrigin } from '@/lib/api/sameOrigin';
import { facultyUuid, facultyNoStore as headers } from '@/lib/api/facultyModuleRoutes';
import { changeAnalyticsShare, getAnalyticsShareStatus } from '@/lib/db/moduleAnalyticsShares';
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context, method: 'GET' | 'POST' | 'DELETE'): Promise<NextResponse> {
  if (method !== 'GET' && !isSameOrigin(request)) return NextResponse.json({ message: 'Invalid request origin.' }, { status: 403, headers });
  try {
    const actor = await requireRole('faculty');
    const { id } = await context.params;
    if (!actor || !facultyUuid.test(id)) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers });
    if (method === 'GET') {
      const status = await getAnalyticsShareStatus(actor.userId, id);
      return status ? NextResponse.json({ status }, { headers }) : NextResponse.json({ message: 'Not found.' }, { status: 404, headers });
    }
    const result = await changeAnalyticsShare(actor.userId, id, method === 'POST');
    if (!result) return NextResponse.json({ message: 'Not found.' }, { status: 404, headers });
    // Return a relative path; the browser supplies the trusted displayed origin.
    return NextResponse.json({ status: result.status, path: result.token ? `/shared/module-analytics/${result.token}` : null }, { headers });
  } catch {
    return NextResponse.json({ message: 'Sharing temporarily unavailable. Refresh sharing status before retrying.' }, { status: 503, headers });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, 'GET');
export const POST = (request: Request, context: Context) => handle(request, context, 'POST');
export const DELETE = (request: Request, context: Context) => handle(request, context, 'DELETE');
