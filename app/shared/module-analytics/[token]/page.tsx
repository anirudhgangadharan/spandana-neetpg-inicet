import type { Metadata } from 'next';
import { getSharedModuleAnalytics } from '@/lib/db/moduleAnalyticsShares';
import { parseAnalyticsQuery, unavailableAnalyticsMessage } from '@/lib/api/sharedAnalytics';
import { ModuleAnalyticsView } from '@/app/faculty/analytics/AnalyticsViews';
import styles from '@/app/faculty/analytics/analytics.module.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shared module analytics', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function SharedAnalyticsPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ page?: string; q?: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const input = await searchParams;
  const query = parseAnalyticsQuery(new URLSearchParams({ page: input.page ?? '1', q: input.q ?? '' }));
  if (!query) return <main id="main" className={styles.page}><h1>Invalid analytics query</h1><p>Use a valid page number and a search of up to 120 characters.</p></main>;
  let analytics;
  try { analytics = await getSharedModuleAnalytics(token, query.page, query.search); }
  catch { return <main id="main" className={styles.page}><h1>Analytics temporarily unavailable</h1><p>Try refreshing this page shortly.</p></main>; }
  if (!analytics) return <main id="main" className={styles.page}><h1>Analytics unavailable</h1><p>{unavailableAnalyticsMessage}</p></main>;
  return <main id="main" className={styles.page}><ModuleAnalyticsView analytics={analytics}
    shared={{ baseUrl: `/shared/module-analytics/${token}`, generatedAt: new Date().toISOString() }} /></main>;
}
