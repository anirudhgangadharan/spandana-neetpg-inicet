import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { getStudentAttempt, StudentAttemptError } from '@/lib/db/moduleAttempts';
import { moduleUuid } from '@/lib/student/moduleInput';
import { AttemptClient } from './AttemptClient';
import styles from '@/app/module-exam.module.css';

export const dynamic = 'force-dynamic';

export default async function StudentAttemptPage({ params }: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireRole('student');
  if (!actor) notFound();
  const { id } = await params;
  if (!moduleUuid.test(id)) notFound();
  let view;
  try {
    view = await getStudentAttempt(id, actor.userId);
  } catch (error) {
    if (error instanceof StudentAttemptError && error.status === 404) notFound();
    throw error;
  }
  return <main id="main" className={styles.page}>
    <Link href="/">← Back to practice</Link>
    <AttemptClient initialView={view} studentId={actor.userId} />
  </main>;
}
