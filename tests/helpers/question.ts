/**
 * Test helpers for constructing questions and arbitrary generators.
 *
 * NOTE: this file names `answerIndex` (via the fast-check generator and the
 * assertions that read it). That is the one carve-out in the CI invariant grep,
 * documented in DECISIONS.md D-012 — T1 and T4 are specified in terms of
 * `q.answerIndex`, so testing them requires naming it.
 */

import fc from 'fast-check';
import type { AnswerIndex, ChoiceType, Question, QuestionFlag, Split } from '@/types';
import { createQuestion } from '@/lib/core/question';

export const ANSWER_INDEX_ARB: fc.Arbitrary<AnswerIndex> = fc.constantFrom<AnswerIndex>(0, 1, 2, 3);

/** Non-empty option text. Deliberately allows duplicates across positions so the
 *  suite proves correctness never depends on options being distinct. */
const OPTION_ARB = fc.string({ minLength: 1, maxLength: 40 }).map((s) => (s.trim().length > 0 ? s : 'x'));

export const QUESTION_ARB: fc.Arbitrary<Question> = fc
  .record({
    id: fc.uuid(),
    split: fc.constantFrom<Split>('train', 'validation'),
    stem: fc.string({ minLength: 10, maxLength: 200 }).map((s) => (s.trim().length >= 10 ? s : 'stem stem stem')),
    options: fc.tuple(OPTION_ARB, OPTION_ARB, OPTION_ARB, OPTION_ARB),
    answer: ANSWER_INDEX_ARB,
    explanation: fc.option(fc.string({ maxLength: 200 }), { nil: null }),
    subject: fc.constantFrom('Anatomy', 'Medicine', 'Unknown', 'Skin'),
    topic: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
    choiceType: fc.constantFrom<ChoiceType>('single', 'multi'),
    flags: fc.uniqueArray(
      fc.constantFrom<QuestionFlag>('no_explanation', 'no_topic', 'multi_choice_type', 'possible_text_corruption'),
      { maxLength: 4 }
    ),
    duplicateOf: fc.option(fc.uuid(), { nil: null }),
    sessionEligible: fc.boolean(),
  })
  .map((r) => createQuestion(r));

export function makeQuestion(overrides: Partial<Parameters<typeof createQuestion>[0]> = {}): Question {
  return createQuestion({
    id: 'q-1',
    split: 'train',
    stem: 'Which vitamin is synthesised solely by microorganisms?',
    options: ['Vitamin A', 'Vitamin C', 'Vitamin B12', 'Vitamin D'],
    answer: 2,
    explanation: null,
    subject: 'Biochemistry',
    topic: null,
    choiceType: 'single',
    flags: [],
    duplicateOf: null,
    sessionEligible: true,
    ...overrides,
  });
}
