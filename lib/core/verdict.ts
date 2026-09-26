/**
 * ⚠ TRUSTED COMPUTING BASE — `lib/core/` (spec §6).
 * Pure TypeScript. Zero React, zero Zustand, zero I/O, zero async.
 *
 * Every correctness decision in the entire application routes through this file.
 * These three functions are total, deterministic and side-effect free.
 *
 * Invariant I1: verdict(q, selection) = (selection === answerIndex(q))
 * Nothing else participates. No string comparison, no normalisation, no
 * similarity, no inference, no model call, no heuristic, no fallback.
 */

import type { AnswerIndex, Question, Verdict } from '@/types';
import { isAnswerIndex } from './answer-index';

function matchesAnswer(answer: AnswerIndex, selected: AnswerIndex): boolean {
  return selected === answer;
}

/**
 * The one comparison. Index equality, nothing else (§13 anti-requirement 2).
 */
export function isCorrect(q: Question, selected: AnswerIndex): boolean {
  return matchesAnswer(q.answerIndex, selected);
}

/**
 * The text of the correct option, read positionally from the frozen tuple.
 * Used for display only — never for determining correctness.
 */
export function correctOptionText(q: Question): string {
  return q.options[q.answerIndex];
}

/**
 * `null` selection means the user moved on without choosing: 'skipped'.
 * 'unattempted' is the absence of an AttemptRecord entirely and is therefore
 * never produced here — a question the user has never reached has no evaluation.
 */
export function evaluate(q: Question, selected: AnswerIndex | null): Verdict {
  if (selected === null) return 'skipped';
  return matchesAnswer(q.answerIndex, selected) ? 'correct' : 'incorrect';
}

/** Score a frozen faculty-module snapshot. Database values are checked again
 * before this trusted comparison; UI code never computes correctness. */
export function scoreModuleAnswers(
  responses: readonly { readonly answer: number; readonly selected: number | null }[],
  policy: { readonly correct: number; readonly wrong: number; readonly blank: number }
): { readonly score: number; readonly correctCount: number; readonly wrongCount: number; readonly unansweredCount: number } {
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;
  for (const response of responses) {
    if (!isAnswerIndex(response.answer) || (response.selected !== null && !isAnswerIndex(response.selected))) {
      throw new Error('Invalid frozen module answer or response.');
    }
    if (response.selected === null) {
      unansweredCount += 1;
      score += policy.blank;
    } else if (matchesAnswer(response.answer, response.selected)) {
      correctCount += 1;
      score += policy.correct;
    } else {
      wrongCount += 1;
      score += policy.wrong;
    }
  }
  return { score, correctCount, wrongCount, unansweredCount };
}

/**
 * The 0-based position of the correct option, exposed for rendering affordances
 * that must mark the right row after submission (e.g. the green fill and check
 * glyph in §9.3). Callers outside `lib/core/` may not read `q.answerIndex`
 * directly — CI greps for it — so this accessor is the sanctioned read path (I3).
 *
 * It deliberately returns the index rather than a mutable reference to anything.
 */
export function correctOptionPosition(q: Question): AnswerIndex {
  return q.answerIndex;
}
