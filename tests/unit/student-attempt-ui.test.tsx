import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttemptClient } from '@/app/module-attempts/[id]/AttemptClient';
import type { StudentAttemptView } from '@/lib/db/moduleAttempts';

const id = '1de98e87-5a44-4d58-9a42-85ff6418c89b';
const question = {
  position: 1, id: 'question-1', source: 'medmcqa' as const,
  stem: 'Which choice is correct?', options: ['Alpha', 'Beta', 'Gamma', 'Delta'] as const,
  subject: 'Medicine', topic: null,
};

const active: StudentAttemptView = {
  status: 'active', id, title: 'Timed mock', attemptNumber: 1,
  startedAt: '2026-09-18T08:00:00.000Z', deadlineAt: '2026-09-18T08:10:00.000Z',
  serverNow: '2026-09-18T08:01:00.000Z', questions: [question], responses: [],
};

describe('student exam rendering', () => {
  it('shows timed, keyboard-reachable questions without answer keys or explanations', () => {
    const html = renderToStaticMarkup(<AttemptClient initialView={active} studentId="student-1" />);
    expect(html).toContain('role="timer"');
    expect(html).toContain('Question 1 of 1');
    expect(html).toContain('Choose one answer for question 1');
    expect(html).toContain('All answers saved.');
    expect(html).not.toContain('correct answer');
    expect(html).not.toContain('SECRET EXPLANATION');
  });

  it('keeps review absent under the score-only policy', () => {
    const final: StudentAttemptView = {
      status: 'submitted', id, title: 'Timed mock', attemptNumber: 1,
      submittedAt: '2026-09-18T08:02:00.000Z', score: 4, maxPoints: 4,
      correctCount: 1, wrongCount: 0, unansweredCount: 0, review: null,
    };
    const html = renderToStaticMarkup(<AttemptClient initialView={final} studentId="student-1" />);
    expect(html).toContain('4 / 4 points');
    expect(html).toContain('Answer review is disabled');
    expect(html).not.toContain('correct answer');
  });

  it('renders explanations only when the final result explicitly contains review', () => {
    const final: StudentAttemptView = {
      status: 'expired', id, title: 'Timed mock', attemptNumber: 1,
      submittedAt: '2026-09-18T08:10:00.000Z', score: 0, maxPoints: 4,
      correctCount: 0, wrongCount: 0, unansweredCount: 1,
      review: [{ ...question, correctIndex: 2, selectedIndex: null, explanation: 'SECRET EXPLANATION' }],
    };
    const html = renderToStaticMarkup(<AttemptClient initialView={final} studentId="student-1" />);
    expect(html).toContain('SECRET EXPLANATION');
    expect(html).toContain('Gamma — correct answer');
  });
});
