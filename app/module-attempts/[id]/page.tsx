import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { getGuestStudentId } from '@/lib/db/guestStudents';
import { getStudentAttempt, StudentAttemptError } from '@/lib/db/moduleAttempts';
import { moduleUuid } from '@/lib/student/moduleInput';
import { FinalAttemptClient } from './FinalAttemptClient';
import styles from '@/app/module-exam.module.css';

export const dynamic = 'force-dynamic';

export default async function StudentAttemptPage({ params }: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  if (!moduleUuid.test(id)) notFound();
  const guestId = await getGuestStudentId(undefined, id);
  const studentId = guestId ?? (await requireRole('student'))?.userId;
  if (!studentId) notFound();
  let view;
  try {
    view = await getStudentAttempt(id, studentId);
  } catch (error) {
    if (error instanceof StudentAttemptError && error.status === 404) notFound();
    throw error;
  }
  return <main id="main" className={styles.page}>
    <FinalAttemptClient initialView={view} />
  </main>;
}
