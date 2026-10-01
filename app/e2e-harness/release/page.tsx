import { notFound } from 'next/navigation';
import { ModuleBuilder } from '@/app/faculty/modules/[id]/ModuleBuilder';
import { FacultyOverviewView, ModuleAnalyticsView } from '@/app/faculty/analytics/AnalyticsViews';
import { AccountDeletionClient } from '@/app/account/delete/AccountDeletionClient';
import { StudentModuleLandingView } from '@/app/modules/[token]/StudentModuleLandingView';
import type { FacultyModuleDetail } from '@/lib/db/facultyModules';
import type { FacultyOverview, ModuleAnalytics } from '@/lib/db/facultyAnalytics';
import type { Facets } from '@/lib/db/queries';
import moduleStyles from '@/app/faculty/modules/modules.module.css';
import analyticsStyles from '@/app/faculty/analytics/analytics.module.css';
import accountStyles from '@/app/account/delete/account-delete.module.css';

export const dynamic = 'force-dynamic';

const draft: FacultyModuleDetail = {
  id: '7399edc6-4c3e-4186-af4c-1bfd3e51c5bc', title: 'Browser faculty module', status: 'draft',
  createdAt: '2030-01-01T09:00:00.000Z', questionCount: 0, openedCount: 0, startedCount: 0,
  submittedCount: 0, expiredCount: 0, description: 'Release-test draft', instructions: 'Answer independently.',
  opensAt: '2030-01-01T10:00:00.000Z', closesAt: '2030-01-01T12:00:00.000Z', durationSeconds: 600,
  maxAttempts: 1, correctPoints: 4, wrongPoints: -1, blankPoints: 0, allowReview: false,
  shareToken: '49e6856c-5cc8-44d3-a055-736794c03711', revision: 0, publishedAt: null, selectedQuestions: [],
};
const facets: Facets = {
  total: 1, sessionEligible: 1, subjects: [{ name: 'Medicine', count: 1 }],
  topicsBySubject: { Medicine: [{ name: 'Cardiology', count: 1 }] },
  flags: [], sources: [{ name: 'medmcqa', count: 1 }],
};
const breakdown = { label: 'Medicine', questionCount: 1, observations: 2, answered: 2, correct: 1, skipped: 0, accuracyPercent: 50, skipPercent: 0 };
const moduleAnalytics: ModuleAnalytics = {
  module: { id: draft.id, title: draft.title, status: 'published', questionCount: 1, openedUsers: 3,
    uniqueStarters: 2, startedAttempts: 2, activeAttempts: 0, submittedAttempts: 1, expiredAttempts: 1,
    finalizedAttempts: 2, incompleteOpens: 1, completionPercent: 100 },
  scores: { sampleSize: 2, mean: 1.5, median: 1.5, highest: 4, lowest: -1,
    highestParticipant: { name: 'Ada', email: 'ada@example.org' },
    lowestParticipant: { name: 'Ben', email: 'ben@example.org' }, distribution: [{ label: '-1–4', count: 2 }] },
  completionTimes: { sampleSize: 2, medianSeconds: 90, distribution: [{ label: '60–120 seconds', count: 2 }] },
  questions: [{ ...breakdown, label: 'Which finding is most likely?', position: 1, questionId: 'q1', subject: 'Medicine',
    topic: 'Cardiology', estimatedTimeMs: 30_000, timingSamples: 2 }], subjects: [breakdown], topics: [{ ...breakdown, label: 'Cardiology' }],
  participants: { page: 1, hasNext: false, search: '', items: [{ attemptId: 'a1', studentName: 'Ada', studentEmail: 'ada@example.org', registrationNumber: null, rollNumber: null, guestParticipantId: null,
    attemptNumber: 1, status: 'submitted', startedAt: '2030-01-01T10:00:00.000Z', completedAt: '2030-01-01T10:01:00.000Z',
    elapsedSeconds: 60, score: 4, correctCount: 1, wrongCount: 0, unansweredCount: 0 }] },
};
const overview: FacultyOverview = {
  modules: [{ ...moduleAnalytics.module, createdAt: draft.createdAt, meanScore: 1.5, needsAttention: false }],
  totals: { modules: 1, openedUsers: 3, startedAttempts: 2, finalizedAttempts: 2 },
  subjects: [breakdown], topics: [{ ...breakdown, label: 'Cardiology' }], frequentlyMissed: moduleAnalytics.questions,
};

export default async function ReleaseHarness({ searchParams }: {
  readonly searchParams: Promise<{ view?: string }>;
}): Promise<React.JSX.Element> {
  if (process.env['E2E_TEST_MODE'] !== '1') notFound();
  const view = (await searchParams).view;
  if (view === 'builder') return <main id="main" className={moduleStyles.page}><ModuleBuilder initialModule={draft} facets={facets} /></main>;
  if (view === 'correction') return <main id="main" className={moduleStyles.page}><ModuleBuilder initialModule={{
    ...draft, revision: 1, questionCount: 1, selectedQuestions: [{
      id: 'question-1', position: 1, source: 'medmcqa', stem: 'Original clinical question?',
      options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correctOption: 1, explanation: null,
      correctionVersion: 0, subject: 'Medicine', topic: 'Cardiology', flags: [], usedElsewhere: false,
    }],
  }} facets={facets} /></main>;
  if (view === 'analytics') return <main id="main" className={analyticsStyles.page}><ModuleAnalyticsView analytics={moduleAnalytics} /></main>;
  if (view === 'shared-analytics') return <main id="main" className={analyticsStyles.page}><ModuleAnalyticsView analytics={moduleAnalytics}
    shared={{ baseUrl: '/shared/module-analytics/synthetic-link', generatedAt: '2026-10-01T00:00:00Z' }} /></main>;
  if (view === 'overview') return <main id="main" className={analyticsStyles.page}><FacultyOverviewView analytics={overview} /></main>;
  if (view === 'account') return <main id="main" className={accountStyles.page}><AccountDeletionClient email="faculty@example.org" isFaculty /></main>;
  if (view === 'attempt-limit') return <StudentModuleLandingView token={draft.shareToken} landing={{
    state: 'open', title: 'Attempt-limited module', description: 'Release-test module', instructions: 'Read each question.',
    questionCount: 20, durationSeconds: 1800, maxAttempts: 1, attemptsUsed: 1, activeAttemptId: null,
    lastAttemptId: '1de98e87-5a44-4d58-9a42-85ff6418c89b', correctPoints: 4, wrongPoints: -1,
    blankPoints: 0, allowReview: false, opensAt: '2030-01-01T10:00:00.000Z', closesAt: '2030-01-01T12:00:00.000Z',
  }} />;
  return <main id="main"><h1>Release harness</h1><p>Select a supported view.</p></main>;
}
