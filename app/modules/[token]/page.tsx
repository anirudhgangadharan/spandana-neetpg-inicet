import { notFound } from 'next/navigation';
import { getGuestStudentId } from '@/lib/db/guestStudents';
import { getPublicModuleLanding, getStudentModuleLanding } from '@/lib/db/studentModules';
import { moduleUuid } from '@/lib/student/moduleInput';
import { StudentModuleLandingView } from './StudentModuleLandingView';

export const dynamic = 'force-dynamic';

export default async function StudentModulePage({ params }: {
  readonly params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  if (!moduleUuid.test(token)) notFound();
  const guestId = await getGuestStudentId(token);
  const landing = guestId ? await getStudentModuleLanding(token, guestId) : await getPublicModuleLanding(token);
  if (landing.state === 'unavailable') notFound();
  return <StudentModuleLandingView landing={landing} token={token} registered={guestId !== null} />;
}
