import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { listOwnedModules } from '@/lib/db/facultyModules';
import { ModuleListClient } from './ModuleListClient';
import styles from './modules.module.css';

export const dynamic = 'force-dynamic';

export default async function FacultyModulesPage({ searchParams }: {
  readonly searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireRole('faculty');
  if (!actor) notFound();
  const requestedPage = Number((await searchParams).page ?? '1');
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;
  const modules = await listOwnedModules(actor.userId, (page - 1) * 50, 51);
  return (
    <main id="main" className={styles.page}>
      <Link href="/">← Back to practice</Link>
      <h1>Your exam modules</h1>
      <p className={styles.intro}>Build timed practice exams from the trusted question bank. Only you can view their content and results.</p>
      <ModuleListClient initialModules={modules.slice(0, 50)} page={page} hasNext={modules.length > 50} />
    </main>
  );
}
