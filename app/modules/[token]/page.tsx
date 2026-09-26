import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/roles';
import { getStudentModuleLanding } from '@/lib/db/studentModules';
import { moduleUuid } from '@/lib/student/moduleInput';
import { StudentModuleLandingView } from './StudentModuleLandingView';

export const dynamic = 'force-dynamic';

export default async function StudentModulePage({ params }: {
  readonly params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const actor = await requireRole('student');
  if (!actor) notFound();
  const { token } = await params;
  if (!moduleUuid.test(token)) notFound();
  const landing = await getStudentModuleLanding(token, actor.userId);
  if (landing.state === 'unavailable') notFound();
  return <StudentModuleLandingView landing={landing} token={token} />;
}
