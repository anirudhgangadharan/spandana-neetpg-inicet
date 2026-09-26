import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { listFacultyGrants } from '@/lib/db/facultyGrants';
import { FacultyManager } from './FacultyManager';
import styles from './faculty.module.css';

export const dynamic = 'force-dynamic';

export default async function SuperAdminFacultyPage(): Promise<React.JSX.Element> {
  if (!(await requireRole('super_admin'))) notFound();
  const faculty = await listFacultyGrants();
  return (
    <main className={styles.page} id="main">
      <Link href="/" className={styles.back}>← Back to practice</Link>
      <h1>Faculty access</h1>
      <p className={styles.intro}>Manage up to three professor accounts. This page shows access status and module counts, not exam content or student results.</p>
      <FacultyManager initialFaculty={faculty} />
    </main>
  );
}
