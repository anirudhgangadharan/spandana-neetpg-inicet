/**
 * §5.2 Validation. Pure — no I/O, no async.
 *
 * Rules are applied per record IN ORDER. The first failure rejects the record
 * with a typed reason code (I4: fail closed — excluded, never repaired, never
 * guessed at, never silently rendered).
 *
 * Warnings do not reject; they attach flags that the UI surfaces.
 */

import type { AnswerIndex, ChoiceType, QuestionFlag, RejectionCode, Split } from '@/types';
import { tryToAnswerIndex } from '@/lib/core/answer-index';
import { containsMarkup, toPlainText } from '@/lib/utils/sanitise';
import { detectCorruption } from './corruption';
import type { SchemaMapping } from './schema';

export interface ValidationContext {
  readonly mapping: SchemaMapping;
  readonly copIndexBase: 0 | 1;
  readonly split: Split;
  /** False for sources whose ground truth is withheld (H2). */
  readonly sourceAnswerable: boolean;
  /** Mutated as records are accepted, to detect `E_DUPLICATE_ID`. */
  readonly seenIds: Set<string>;
  /** Corrupted tokens derived from the corpus (H4). */
  readonly corruptionLexicon: ReadonlySet<string>;
}

export interface AcceptedRecord {
  readonly id: string;
  readonly split: Split;
  readonly stem: string;
  readonly options: readonly [string, string, string, string];
  readonly answer: AnswerIndex;
  readonly explanation: string | null;
  readonly subject: string;
  readonly topic: string | null;
  readonly choiceType: ChoiceType;
  /** Flags known from this record alone. Corpus-wide flags (duplicates, H9
   *  conflicts) are added later by the ETL once the whole corpus is indexed. */
  readonly flags: readonly QuestionFlag[];
  readonly corruptedTokens: readonly string[];
}

export type ValidationResult =
  | { readonly ok: true; readonly record: AcceptedRecord }
  | { readonly ok: false; readonly code: RejectionCode; readonly id: string | null; readonly detail: string };

const reject = (code: RejectionCode, id: string | null, detail: string): ValidationResult =>
  ({ ok: false, code, id, detail });

function readString(raw: Record<string, unknown>, key: string | null): string | null {
  if (key === null) return null;
  const v = raw[key];
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : String(v);
}

export const MIN_STEM_LENGTH = 10;

export function validateRecord(raw: unknown, ctx: ValidationContext): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return reject('E_MISSING_ID', null, 'record is not an object');
  }
  const rec = raw as Record<string, unknown>;
  const m = ctx.mapping;

  // --- E_MISSING_ID ---------------------------------------------------------
  const rawId = readString(rec, m.id);
  const id = rawId === null ? '' : rawId.trim();
  if (id.length === 0) return reject('E_MISSING_ID', null, 'id absent or empty');

  // --- E_DUPLICATE_ID -------------------------------------------------------
  if (ctx.seenIds.has(id)) return reject('E_DUPLICATE_ID', id, 'id already seen in this build');

  // --- E_MISSING_STEM -------------------------------------------------------
  // Sanitise BEFORE measuring: a stem that is 40 characters of markup is empty.
  const rawStem = readString(rec, m.stem);
  const stem = toPlainText(rawStem);
  if (stem.length < MIN_STEM_LENGTH) {
    return reject('E_MISSING_STEM', id, `stem is ${stem.length} chars after sanitising (minimum ${MIN_STEM_LENGTH})`);
  }

  // --- E_OPTION_COUNT -------------------------------------------------------
  if (m.options.length < 4) {
    return reject('E_OPTION_COUNT', id, `schema exposes ${m.options.length} option fields, need 4`);
  }
  const presentKeys = m.options.filter((k) => k in rec);
  if (presentKeys.length < 4) {
    return reject('E_OPTION_COUNT', id, `record carries ${presentKeys.length} of 4 option fields`);
  }

  // --- E_OPTION_EMPTY -------------------------------------------------------
  const opts = m.options.slice(0, 4).map((k) => toPlainText(readString(rec, k)));
  const emptyAt = opts.findIndex((o) => o.length === 0);
  if (emptyAt !== -1) {
    return reject('E_OPTION_EMPTY', id, `option ${'ABCD'.charAt(emptyAt)} is empty after sanitising`);
  }

  // --- E_OPTION_DISTINCT ----------------------------------------------------
  const distinctCount = new Set(opts).size;
  if (distinctCount < 2) {
    return reject('E_OPTION_DISTINCT', id, `only ${distinctCount} distinct option(s)`);
  }

  // --- E_ANSWER_UNRESOLVED --------------------------------------------------
  // A split whose ground truth the authors withhold can never be answerable (H2).
  if (!ctx.sourceAnswerable || m.answer === null) {
    return reject('E_ANSWER_UNRESOLVED', id, `split "${ctx.split}" carries no answer field (withheld ground truth)`);
  }

  // --- E_ANSWER_MISSING -----------------------------------------------------
  const rawCop = rec[m.answer];
  if (rawCop === null || rawCop === undefined) {
    return reject('E_ANSWER_MISSING', id, 'cop is null or undefined');
  }

  // --- E_ANSWER_RANGE -------------------------------------------------------
  // This is where a sentinel (-1, or 0 in a 1-based file) is caught: it
  // normalises outside {0,1,2,3} and is rejected rather than clamped.
  const normalised = tryToAnswerIndex(rawCop, ctx.copIndexBase);
  if (!normalised.ok) return reject('E_ANSWER_RANGE', id, normalised.reason);
  const answer: AnswerIndex = normalised.value;

  // --- Accepted. Compute warning flags. -------------------------------------
  // `opts` has exactly four entries: it is `m.options.slice(0, 4)` mapped, and
  // the E_OPTION_COUNT check above established that at least four keys exist.
  const options = opts as unknown as readonly [string, string, string, string];

  const rawExplanation = readString(rec, m.explanation);
  const explanationText = toPlainText(rawExplanation);
  const explanation = explanationText.length > 0 ? explanationText : null;

  const rawSubject = readString(rec, m.subject);
  const subjectText = toPlainText(rawSubject);
  // A.5/D-008: `"Unknown"` is a literal subject value in this corpus, not a null.
  const subject = subjectText.length > 0 ? subjectText : 'Unknown';

  const rawTopic = readString(rec, m.topic);
  const topicText = toPlainText(rawTopic);
  const topic = topicText.length > 0 ? topicText : null;

  const rawChoiceType = (readString(rec, m.choiceType) ?? '').trim().toLowerCase();
  const choiceType: ChoiceType = rawChoiceType === 'multi' ? 'multi' : 'single';

  const flags: QuestionFlag[] = [];
  if (explanation === null) flags.push('no_explanation');
  if (topic === null) flags.push('no_topic');
  if (choiceType === 'multi') flags.push('multi_choice_type');
  if (distinctCount === 3) flags.push('three_distinct_options');
  if (distinctCount === 2) flags.push('two_distinct_options');

  if (
    containsMarkup(rawStem) ||
    containsMarkup(rawExplanation) ||
    m.options.slice(0, 4).some((k) => containsMarkup(readString(rec, k)))
  ) {
    flags.push('markup_stripped');
  }

  // H4 — scan stem and options only. Explanations are excluded because a
  // corrupted explanation is a readability problem, whereas a corrupted stem or
  // option can change what the question means.
  const corruptedTokens = detectCorruption([stem, ...options].join(' '), ctx.corruptionLexicon);
  if (corruptedTokens.length > 0) flags.push('possible_text_corruption');

  ctx.seenIds.add(id);

  return {
    ok: true,
    record: {
      id,
      split: ctx.split,
      stem,
      options,
      answer,
      explanation,
      subject,
      topic,
      choiceType,
      flags,
      corruptedTokens,
    },
  };
}
