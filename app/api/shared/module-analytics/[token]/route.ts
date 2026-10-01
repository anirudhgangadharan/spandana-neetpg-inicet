import { NextResponse } from 'next/server';
import { getSharedModuleAnalytics } from '@/lib/db/moduleAnalyticsShares';
import { parseAnalyticsQuery, sharedAnalyticsHeaders as headers, unavailableAnalyticsMessage } from '@/lib/api/sharedAnalytics';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const query = parseAnalyticsQuery(new URL(request.url).searchParams);
  if (!query) return NextResponse.json({ message: 'Invalid analytics query.' }, { status: 400, headers });
  try {
    const { token } = await context.params;
    const analytics = await getSharedModuleAnalytics(token, query.page, query.search);
    return analytics ? NextResponse.json({ analytics, generatedAt: new Date().toISOString() }, { headers })
      : NextResponse.json({ message: unavailableAnalyticsMessage }, { status: 404, headers });
  } catch {
    return NextResponse.json({ message: 'Analytics temporarily unavailable. Try again shortly.' }, { status: 503, headers });
  }
}
