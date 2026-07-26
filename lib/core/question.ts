/**
 * ⚠ TRUSTED COMPUTING BASE — `lib/core/` (spec §6).
 * Pure TypeScript. Zero React, zero Zustand, zero I/O, zero async.
 *
 * The frozen, typed accessor required by I3. Every {@link Question} in the system
 * is constructed here and returned deeply frozen, so no layer above can mutate an
 * answer key even by accident.
 */

import type { AnswerIndex, ChoiceType, Question, QuestionFlag, Split } from '@/types';
import { isAnswerIndex } from './answer-index';

/** The persisted row shape. Column names are snake_case and deliberately differ
 *  from the `Question` field names so that no layer outside this file needs to
 *  name the answer field at all. */
export interface QuestionRow {
  readonly id: string;
  readonly split: string;
  readonly stem: string;
  readonly opt_a: string;
  readonly opt_b: string;
  readonly opt_c: string;
  readonly opt_d: string;
  readonly answer_index: number;
  readonly explanation: string | null;
  readonly subject: string;
  readonly topic: string | null;
  readonly choice_type: string;
  /** JSON-encoded `QuestionFlag[]` */
  readonly flags: string;
  readonly duplicate_of: string | null;
  readonly session_eligible: number;
}

export class CorpusIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorpusIntegrityError';
  }
}

export interface CreateQuestionInput {
  readonly id: string;
  readonly split: Split;
  readonly stem: string;
  readonly options: readonly [string, string, string, string];
  readonly answer: AnswerIndex;
  readonly explanation: string | null;
  readonly subject: string;
  readonly topic: string | null;
  readonly choiceType: ChoiceType;
  readonly flags: readonly QuestionFlag[];
  readonly duplicateOf: string | null;
  readonly sessionEligible: boolean;
}

/**
 * Construct a deeply-frozen Question. This is the only constructor in the system.
 *
 * Note the input field is named `answer`, not `answerIndex`: callers (the ETL,
 * the db layer) never spell the protected identifier, which is what makes the
 * CI grep in `scripts/ci/check-invariants.mjs` a meaningful check rather than a
 * cosmetic one.
 */
export function createQuestion(input: CreateQuestionInput): Question {
  if (!isAnswerIndex(input.answer)) {
    throw new CorpusIntegrityError(`question ${input.id}: answer ${String(input.answer)} outside {0,1,2,3}`);
  }
  if (input.options.length !== 4) {
    throw new CorpusIntegrityError(`question ${input.id}: expected 4 options, got ${input.options.length}`);
  }
  if (input.options[input.answer].trim().length === 0) {
    throw new CorpusIntegrityError(`question ${input.id}: the correct option is empty`);
  }

  const q: Question = {
    id: input.id,
    split: input.split,
    stem: input.stem,
    options: Object.freeze([input.options[0], input.options[1], input.options[2], input.options[3]] as const),
    answerIndex: input.answer,
    explanation: input.explanation,
    subject: input.subject,
    topic: input.topic,
    choiceType: input.choiceType,
    flags: Object.freeze([...input.flags]),
    duplicateOf: input.duplicateOf,
    sessionEligible: input.sessionEligible,
  };
  return Object.freeze(q);
}

const SPLITS: readonly string[] = ['train', 'validation'];
const CHOICE_TYPES: readonly string[] = ['single', 'multi'];

/**
 * Map a persisted row to a frozen Question, failing closed on anything the
 * database should not have been able to contain. A corrupted `corpus.sqlite`
 * raises here rather than rendering a wrong answer (I4, T6).
 */
export function questionFromRow(row: QuestionRow): Question {
  if (!isAnswerIndex(row.answer_index)) {
    throw new CorpusIntegrityError(`row ${row.id}: answer_index ${row.answer_index} outside {0,1,2,3}`);
  }
  if (!SPLITS.includes(row.split)) {
    throw new CorpusIntegrityError(`row ${row.id}: unknown split "${row.split}"`);
  }
  if (!CHOICE_TYPES.includes(row.choice_type)) {
    throw new CorpusIntegrityError(`row ${row.id}: unknown choice_type "${row.choice_type}"`);
  }

  let flags: readonly QuestionFlag[];
  try {
    const parsed: unknown = JSON.parse(row.flags);
    if (!Array.isArray(parsed) || parsed.some((f) => typeof f !== 'string')) {
      throw new Error('flags is not a string array');
    }
    flags = parsed as QuestionFlag[];
  } catch (err) {
    throw new CorpusIntegrityError(`row ${row.id}: unreadable flags column — ${String(err)}`);
  }

  return createQuestion({
    id: row.id,
    split: row.split as Split,
    stem: row.stem,
    options: [row.opt_a, row.opt_b, row.opt_c, row.opt_d],
    answer: row.answer_index,
    explanation: row.explanation,
    subject: row.subject,
    topic: row.topic,
    choiceType: row.choice_type as ChoiceType,
    flags,
    duplicateOf: row.duplicate_of,
    sessionEligible: row.session_eligible === 1,
  });
}
