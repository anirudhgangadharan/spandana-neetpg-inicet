import { notFound } from 'next/navigation';
import { AttemptClient } from '@/app/module-attempts/[id]/AttemptClient';
import type { StudentAttemptView } from '@/lib/db/moduleAttempts';
import styles from '@/app/module-exam.module.css';

export const dynamic = 'force-dynamic';

export default async function ModuleAttemptHarness({ searchParams }: {
  readonly searchParams: Promise<{ expired?: string }>;
}): Promise<React.JSX.Element> {
  if (process.env['E2E_TEST_MODE'] !== '1') notFound();
  const expired = (await searchParams).expired === '1';
  const deadlineAt = '2030-01-01T10:10:00.000Z';
  const initialView: StudentAttemptView = {
    status: 'active', id: '1de98e87-5a44-4d58-9a42-85ff6418c89b', title: 'Browser test module',
    attemptNumber: 1, startedAt: '2030-01-01T10:00:00.000Z', deadlineAt,
    serverNow: expired ? deadlineAt : '2030-01-01T10:01:00.000Z', responses: [],
    questions: [{
      position: 1, id: 'question-1', source: 'medmcqa', subject: 'Medicine', topic: 'Cardiology',
      stem: 'Which option should be selected in this browser test?',
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    }],
  };
  return <main id="main" className={styles.page}>
    <AttemptClient initialView={initialView} studentId="e2e-student" />
  </main>;
}
