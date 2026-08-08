/**
 * Question-source display constants. Pure data, no Node imports — safe to
 * import from both server (`lib/parser/usmle.ts`) and client ('use client')
 * code, which is exactly why this exists as its own module rather than living
 * inside `lib/parser/usmle.ts` (which imports `node:crypto` and must never be
 * pulled into a browser bundle).
 */

import type { QuestionSource } from '@/types';

/** Display label for the "Question bank" selector (§8 P0, D-021). */
export const SOURCE_LABEL: Readonly<Record<QuestionSource, string>> = Object.freeze({
  medmcqa: 'MedMCQA',
  usmle: 'USMLE (US, Step 1 / 2 & 3)',
});

/**
 * USMLE's `meta_info` (exam stage, not clinical subject) mapped to the literal
 * `subject` bucket it becomes (D-023). `usmle.ts`'s `subjectForMetaInfo` is the
 * only place that WRITES using this map; the UI reads it (via
 * `USMLE_SUBJECT_LABELS` below) only to know which `subject` facet values
 * belong to the USMLE question bank, so the "Subject" checklist can be scoped
 * to whichever source(s) are selected.
 */
export const META_INFO_TO_SUBJECT: Readonly<Record<string, string>> = Object.freeze({
  step1: 'USMLE Step 1',
  'step2&3': 'USMLE Step 2 & 3',
});

/** The bucket an unrecognised `meta_info` value falls open to (D-023, D-008's "Unknown" precedent). */
export const USMLE_FALLBACK_SUBJECT = 'USMLE';

/**
 * Every `subject` value a USMLE row can ever carry. Enumerable and closed
 * because `META_INFO_TO_SUBJECT` is a closed map — used by the UI to bucket
 * the (source-unscoped) subject facet by question bank without a fragile
 * string-prefix guess.
 */
export const USMLE_SUBJECT_LABELS: readonly string[] = Object.freeze([
  ...Object.values(META_INFO_TO_SUBJECT),
  USMLE_FALLBACK_SUBJECT,
]);
