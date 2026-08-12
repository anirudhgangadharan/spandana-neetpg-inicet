/**
 * ⚠ TRUSTED COMPUTING BASE — `lib/core/` (spec §6).
 * Pure TypeScript. Zero React, zero Zustand, zero I/O, zero async.
 *
 * Validates an unknown value into an {@link AttemptRecord}. Shared by the
 * client's IndexedDB write path (lib/storage/attempts.ts) and the server's
 * /api/sync route, so a record is accepted or rejected by exactly one set of
 * rules regardless of which side is reading it (T5: nothing trusts what it
 * finds, including a payload from the client).
 */

import type { AttemptRecord, Confidence, Verdict } from '@/types';
import { isAnswerIndex } from './answer-index';

const VERDICTS: readonly string[] = ['correct', 'incorrect', 'unattempted', 'skipped'];
const CONFIDENCES: readonly string[] = ['know', 'fairly_sure', 'guessing'];

/**
 * Note what is NOT accepted: any extra properties on the input are dropped
 * rather than spread through, so an injected `answerIndex` field cannot ride
 * along into application state (I3, T5).
 */
export function parseAttemptRecord(value: unknown): AttemptRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (typeof v['questionId'] !== 'string' || v['questionId'].length === 0) return null;

  const selected = v['selectedIndex'];
  if (selected !== null && !isAnswerIndex(selected)) return null;

  if (typeof v['verdict'] !== 'string' || !VERDICTS.includes(v['verdict'])) return null;

  const attemptedAt = v['attemptedAt'];
  if (typeof attemptedAt !== 'number' || !Number.isFinite(attemptedAt) || attemptedAt < 0) return null;

  const durationMs = v['durationMs'];
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;

  const confidenceRaw = v['confidence'];
  if (confidenceRaw !== undefined && confidenceRaw !== null && !CONFIDENCES.includes(confidenceRaw as string)) {
    return null;
  }
  const confidence = (confidenceRaw ?? null) as Confidence | null;

  return {
    questionId: v['questionId'],
    selectedIndex: selected === null ? null : selected,
    verdict: v['verdict'] as Verdict,
    attemptedAt,
    durationMs,
    bookmarked: v['bookmarked'] === true,
    confidence,
  };
}
