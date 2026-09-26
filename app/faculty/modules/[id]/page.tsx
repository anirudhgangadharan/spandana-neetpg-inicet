import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { getOwnedModuleDetail } from '@/lib/db/facultyModules';
import { getFacets } from '@/lib/db/queries';
import { ModuleBuilder } from './ModuleBuilder';
import styles from '../modules.module.css';

export const dynamic = 'force-dynamic';

export default async function FacultyModulePage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const actor = await requireRole('faculty');
  if (!actor) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const detail = await getOwnedModuleDetail(actor.userId, id);
  if (!detail) notFound();
  return (
    <main id="main" className={styles.page}>
      <Link href="/faculty/modules">← All modules</Link>
      <ModuleBuilder initialModule={detail} facets={getFacets()} />
    </main>
  );
}
