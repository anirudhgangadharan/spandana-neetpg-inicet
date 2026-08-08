/**
 * USMLE (MedQA-USMLE, US English 4-option subset) ingestion — pure, no I/O, no
 * async, matching every other file in `lib/parser/` and subject to the same
 * 100%-branch-coverage gate (`vitest.config.ts`'s `lib/parser/**\/*.ts` glob).
 *
 * This is a standalone counterpart to `validate.ts` + `cop-base.ts`, not an
 * extension of either, for two reasons (DECISIONS.md D-024/D-025):
 *
 *  1. Schema shape: USMLE's options live in a single nested object keyed
 *     `"A".."D"` (`{question, options: {A,B,C,D}, answer, answer_idx, meta_info}`),
 *     not four sibling top-level fields the way MedMCQA's `opa/opb/opc/opd` are.
 *     `lib/parser/schema.ts`'s structural detector inspects top-level keys only
 *     and genuinely cannot see into a nested object without a flattening shim —
 *     writing a dedicated adapter is cleaner than forcing this shape through
 *     machinery built for a different one.
 *  2. Answer resolution: `answer_idx` is a single letter, unambiguous by
 *     construction. MedMCQA's `cop`-index-base ambiguity (H1, resolved by three
 *     independent empirical methods in `cop-base.ts`) simply doesn't exist here
 *     — there is nothing to cross-check.
 *
 * Reuses `validate.ts`'s exported `AcceptedRecord`/`ValidationResult`/
 * `MIN_STEM_LENGTH` so the ETL's downstream handling doesn't need to branch by
 * shape, only by which validator produced the record.
 */

import { createHash } from 'node:crypto';
import type { AnswerIndex, ChoiceType, QuestionFlag, RejectionCode, Split } from '@/types';
import type { AnswerIndexResult } from '@/lib/core/answer-index';
import { META_INFO_TO_SUBJECT, USMLE_FALLBACK_SUBJECT } from '@/lib/constants/sources';
import { containsMarkup, toPlainText } from '@/lib/utils/sanitise';
import { MIN_STEM_LENGTH, type AcceptedRecord, type ValidationResult } from './validate';

export { META_INFO_TO_SUBJECT } from '@/lib/constants/sources';

const reject = (code: RejectionCode, id: string | null, detail: string): ValidationResult =>
  ({ ok: false, code, id, detail });

// ---------------------------------------------------------------------------
// Answer letter resolution — the standalone counterpart to toAnswerIndex/
// tryToAnswerIndex, sharing their result shape but none of their H1 logic.
// ---------------------------------------------------------------------------

const LETTER_TO_INDEX: Readonly<Record<string, AnswerIndex>> = Object.freeze({
  A: 0,
  B: 1,
  C: 2,
  D: 3,
});

/**
 * `A`-`D` (case-insensitive, whitespace-tolerant) -> 0-3. Fails closed on
 * anything else (I4) — empty, lowercase mixed oddly, multi-character, a digit,
 * or a fifth letter like `E` (which exists in the 5-option USMLE files this
 * ETL deliberately does not ingest — see DECISIONS.md scope note).
 */
export function resolveUsmleLetter(rawLetter: unknown): AnswerIndexResult {
  if (typeof rawLetter !== 'string') {
    return { ok: false, reason: `answer_idx is not a string: ${String(rawLetter)}` };
  }
  const trimmed = rawLetter.trim().toUpperCase();
  const value = LETTER_TO_INDEX[trimmed];
  if (value === undefined) {
    return { ok: false, reason: `answer_idx "${rawLetter}" is not one of A-D` };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// meta_info -> subject (D-023): USMLE's exam-stage label becomes a literal
// subject bucket, reusing all existing subject/topic filter plumbing. The map
// itself lives in `lib/constants/sources.ts` (browser-safe, shared with the UI).
// ---------------------------------------------------------------------------

/** Unrecognised `meta_info` values fail OPEN to a labelled bucket rather than
 *  rejecting the record — a stray third value shouldn't halt otherwise-valid
 *  data, and "USMLE" honestly discloses what it is, the same way "Unknown"
 *  does for MedMCQA (D-008). */
export function subjectForMetaInfo(rawMetaInfo: unknown): string {
  if (typeof rawMetaInfo !== 'string') return USMLE_FALLBACK_SUBJECT;
  return META_INFO_TO_SUBJECT[rawMetaInfo.trim().toLowerCase()] ?? USMLE_FALLBACK_SUBJECT;
}

// ---------------------------------------------------------------------------
// Deterministic id synthesis (D-026) — USMLE has no id field at all.
// ---------------------------------------------------------------------------

/**
 * `usmle-` + a content hash. Same input always reproduces the same id, so a
 * rebuild from the same source files is stable.
 *
 * Keyed by the RAW split token (`train`/`dev`/`test`, before the D-A fold into
 * the two-value `Split` union) rather than the mapped `Split`, so the id stays
 * stable even if the fold policy changes later.
 *
 * The `usmle-` prefix makes collision with MedMCQA's UUID-format ids
 * structurally impossible — a different id alphabet entirely, not merely
 * different by convention.
 */
export function synthesizeUsmleId(
  splitToken: string,
  record: { readonly stem: string; readonly options: readonly [string, string, string, string]; readonly answerLetter: string }
): string {
  // A control character separates fields, so e.g. stem="ab"+opt="c" cannot
  // hash the same as stem="a"+opt="bc". Built via fromCharCode rather than a
  // literal escape so no raw control byte sits in this source file.
  const SEP = String.fromCharCode(1);
  const h = createHash('sha256');
  h.update(splitToken);
  h.update(SEP);
  h.update(record.stem);
  for (const opt of record.options) {
    h.update(SEP);
    h.update(opt);
  }
  h.update(SEP);
  h.update(record.answerLetter);
  return `usmle-${h.digest('hex').slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface UsmleValidationContext {
  readonly split: Split;
  /** Mutated as records are accepted, to detect a content-identical repeat.
   *  Shared with MedMCQA's context by the ETL (defense in depth — the
   *  `usmle-` id prefix already makes cross-source collision impossible). */
  readonly seenIds: Set<string>;
}

interface UsmleRawShape {
  readonly question: unknown;
  readonly options: unknown;
  readonly answer_idx: unknown;
  readonly meta_info: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

/**
 * `splitToken` is the raw, pre-fold split label (`train`/`dev`/`test`) — used
 * for id synthesis and for the `Rejection.split` label the ETL records, kept
 * distinct from `ctx.split` (the mapped `Split` the accepted record carries).
 */
export function validateUsmleRecord(raw: unknown, splitToken: string, ctx: UsmleValidationContext): ValidationResult {
  if (!isPlainObject(raw)) {
    return reject('E_MISSING_ID', null, 'record is not an object');
  }
  const rec = raw as unknown as UsmleRawShape;

  // --- E_MISSING_STEM ---------------------------------------------------
  const stem = toPlainText(typeof rec.question === 'string' ? rec.question : null);
  if (stem.length < MIN_STEM_LENGTH) {
    return reject('E_MISSING_STEM', null, `stem is ${stem.length} chars after sanitising (minimum ${MIN_STEM_LENGTH})`);
  }

  // --- E_OPTION_COUNT -----------------------------------------------------
  if (!isPlainObject(rec.options)) {
    return reject('E_OPTION_COUNT', null, 'options is not an object');
  }
  const rawOptions = rec.options;
  const presentLetters = OPTION_LETTERS.filter((letter) => letter in rawOptions);
  if (presentLetters.length < 4) {
    return reject('E_OPTION_COUNT', null, `record carries ${presentLetters.length} of 4 option keys (A-D)`);
  }

  // --- E_OPTION_EMPTY -------------------------------------------------------
  const opts = OPTION_LETTERS.map((letter) => {
    const v = rawOptions[letter];
    return toPlainText(typeof v === 'string' ? v : v === null || v === undefined ? null : String(v));
  });
  const emptyAt = opts.findIndex((o) => o.length === 0);
  if (emptyAt !== -1) {
    return reject('E_OPTION_EMPTY', null, `option ${OPTION_LETTERS[emptyAt]} is empty after sanitising`);
  }
  const options = opts as unknown as readonly [string, string, string, string];

  // --- E_OPTION_DISTINCT ----------------------------------------------------
  const distinctCount = new Set(opts).size;
  if (distinctCount < 2) {
    return reject('E_OPTION_DISTINCT', null, `only ${distinctCount} distinct option(s)`);
  }

  // --- E_ANSWER_MISSING / E_ANSWER_RANGE -------------------------------------
  if (rec.answer_idx === null || rec.answer_idx === undefined) {
    return reject('E_ANSWER_MISSING', null, 'answer_idx is null or undefined');
  }
  const resolved = resolveUsmleLetter(rec.answer_idx);
  if (!resolved.ok) return reject('E_ANSWER_RANGE', null, resolved.reason);
  const answer: AnswerIndex = resolved.value;
  // Not a separate check: `options[answer]` is guaranteed non-empty here —
  // `resolveUsmleLetter` only accepts A-D, and every one of A-D was already
  // confirmed present and non-empty above.

  const answerLetter = OPTION_LETTERS[answer];

  // --- E_DUPLICATE_ID ---------------------------------------------------
  // USMLE has no native id; the id IS a content hash, so a byte-for-byte
  // repeat of stem+options+answer collides here before H6's near-duplicate
  // pass ever runs.
  const id = synthesizeUsmleId(splitToken, { stem, options, answerLetter });
  if (ctx.seenIds.has(id)) return reject('E_DUPLICATE_ID', id, 'id already seen in this build');
  ctx.seenIds.add(id);

  // --- Accepted. Compute warning flags. -------------------------------------
  const subject = subjectForMetaInfo(rec.meta_info);
  const choiceType: ChoiceType = 'single';

  // Always true: the schema has no explanation field at all (confirmed by
  // sampling — see DECISIONS.md scope note). This reuses the EXISTING,
  // already-tested empty-state UI verbatim; no new UI is needed for it.
  const flags: QuestionFlag[] = ['no_explanation'];
  if (distinctCount === 3) flags.push('three_distinct_options');
  if (distinctCount === 2) flags.push('two_distinct_options');

  // `rec.question` is a string here, not re-checked: the stem-length check
  // above already rejected any record where it wasn't (a non-string sanitises
  // to '', which is always < MIN_STEM_LENGTH), so re-branching on its type
  // would be dead code this function's own control flow can never reach.
  const rawQuestion = rec.question as string;
  if (
    containsMarkup(rawQuestion) ||
    OPTION_LETTERS.some((letter) => {
      const v = rawOptions[letter];
      return containsMarkup(typeof v === 'string' ? v : null);
    })
  ) {
    flags.push('markup_stripped');
  }

  const record: AcceptedRecord = {
    id,
    split: ctx.split,
    stem,
    options,
    answer,
    explanation: null,
    subject,
    topic: null,
    choiceType,
    flags,
    corruptedTokens: [],
  };

  return { ok: true, record };
}
