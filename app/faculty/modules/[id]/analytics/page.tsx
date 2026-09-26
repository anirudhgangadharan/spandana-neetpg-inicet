import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { getOwnedModuleAnalytics } from '@/lib/db/facultyAnalytics';
import { ModuleAnalyticsView } from '@/app/faculty/analytics/AnalyticsViews';
import styles from '@/app/faculty/analytics/analytics.module.css';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FacultyModuleAnalyticsPage({ params, searchParams }: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ page?: string; q?: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireRole('faculty');
  if (!actor) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const requestedPage = Number(query.page ?? '1');
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;
  const search = (query.q ?? '').trim().slice(0, 120);
  const analytics = await getOwnedModuleAnalytics(actor.userId, id, page, search);
  if (!analytics) notFound();
  return <main id="main" className={styles.page}><ModuleAnalyticsView analytics={analytics} /></main>;
}
