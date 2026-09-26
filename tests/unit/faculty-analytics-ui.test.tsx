import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModuleAnalyticsView } from '@/app/faculty/analytics/AnalyticsViews';
import type { ModuleAnalytics } from '@/lib/db/facultyAnalytics';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const analytics: ModuleAnalytics = {
  module: { id: 'module-1', title: 'Cardiology mock', status: 'published', questionCount: 1,
    openedUsers: 3, uniqueStarters: 2, startedAttempts: 2, activeAttempts: 0,
    submittedAttempts: 1, expiredAttempts: 1, finalizedAttempts: 2, incompleteOpens: 1, completionPercent: 100 },
  scores: { sampleSize: 2, mean: 1.5, median: 1.5, highest: 4, lowest: -1,
    highestParticipant: { name: 'Ada', email: 'ada@example.org' }, lowestParticipant: { name: null, email: 'ben@example.org' },
    distribution: [{ label: '-1–4', count: 2 }] },
  completionTimes: { sampleSize: 2, medianSeconds: 90, distribution: [{ label: '60–120', count: 2 }] },
  questions: [{ label: 'Clinical question', position: 1, questionId: 'q1', subject: 'Medicine', topic: 'Cardiology',
    questionCount: 1, observations: 2, answered: 2, correct: 1, skipped: 0, accuracyPercent: 50,
    skipPercent: 0, estimatedTimeMs: 30_000, timingSamples: 1 }],
  subjects: [{ label: 'Medicine', questionCount: 1, observations: 2, answered: 2, correct: 1, skipped: 0,
    accuracyPercent: 50, skipPercent: 0 }],
  topics: [], participants: { items: [], page: 1, hasNext: false, search: '' },
};

describe('faculty analytics UI', () => {
  it('labels samples and timing limitations and uses accessible data tables', () => {
    const html = renderToStaticMarkup(<ModuleAnalyticsView analytics={analytics} />);
    expect(html).toContain('Small sample: 2 finalized attempts');
    expect(html).toContain('bounded server-observed estimate');
    expect(html).toContain('<caption>Question analysis</caption>');
    expect(html).toContain('scope="col"');
    expect(html).not.toMatch(/answer_index|correctIndex|explanation/);
  });
});
