/**
 * ⚠ TRUSTED COMPUTING BASE — `lib/core/` (spec §6).
 *
 * Browser-safe barrel. `answer-key.ts` is deliberately NOT re-exported here: it
 * imports `node:crypto` and is only ever needed at build time and on the server.
 * Import it by path where required.
 */

export { isCorrect, correctOptionText, evaluate, correctOptionPosition } from './verdict';
export { ANSWER_INDICES, isAnswerIndex, toAnswerIndex, AnswerNormalisationError } from './answer-index';
export { createQuestion, questionFromRow, CorpusIntegrityError } from './question';
export type { QuestionRow, CreateQuestionInput } from './question';
