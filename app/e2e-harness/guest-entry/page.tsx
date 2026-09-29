import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { StudentModuleLandingView } from '@/app/modules/[token]/StudentModuleLandingView';

const token = '32ed02eb-f7ed-492c-9ee6-8bd47f6d910f';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Guest test entry browser check' };

export default function GuestEntryHarness(): React.JSX.Element {
  if (process.env['E2E_TEST_MODE'] !== '1') notFound();
  return <StudentModuleLandingView token={token} registered={false} landing={{
    state: 'open', title: 'Browser test module', description: null, instructions: 'Answer independently.',
    questionCount: 1, durationSeconds: 600, maxAttempts: 1, attemptsUsed: 0,
    activeAttemptId: null, lastAttemptId: null, correctPoints: 4, wrongPoints: -1,
    blankPoints: 0, allowReview: false,
    opensAt: '2030-01-01T10:00:00.000Z', closesAt: '2030-01-01T11:00:00.000Z',
  }} />;
}
