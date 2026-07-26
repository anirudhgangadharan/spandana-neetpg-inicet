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

/**
 * The one comparison. Index equality, nothing else (§13 anti-requirement 2).
 */
export function isCorrect(q: Question, selected: AnswerIndex): boolean {
  return selected === q.answerIndex;
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
  return selected === q.answerIndex ? 'correct' : 'incorrect';
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
