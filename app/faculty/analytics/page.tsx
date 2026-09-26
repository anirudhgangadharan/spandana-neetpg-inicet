import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { getFacultyOverview } from '@/lib/db/facultyAnalytics';
import { FacultyOverviewView } from './AnalyticsViews';
import styles from './analytics.module.css';

export const dynamic = 'force-dynamic';

export default async function FacultyAnalyticsPage(): Promise<React.JSX.Element> {
  const actor = await requireRole('faculty');
  if (!actor) notFound();
  return <main id="main" className={styles.page}><FacultyOverviewView analytics={await getFacultyOverview(actor.userId)} /></main>;
}
