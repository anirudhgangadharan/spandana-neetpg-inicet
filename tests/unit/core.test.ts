/**
 * The trusted computing base (§6) and invariant I1.
 *
 * 100% branch coverage is required here with no exceptions (§12.3).
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { correctOptionPosition, correctOptionText, evaluate, isCorrect } from '@/lib/core/verdict';
import {
  ANSWER_INDICES,
  AnswerNormalisationError,
  isAnswerIndex,
  toAnswerIndex,
  tryToAnswerIndex,
} from '@/lib/core/answer-index';
import { CorpusIntegrityError, createQuestion, questionFromRow, type QuestionRow } from '@/lib/core/question';
import { computeAnswerKeyHash } from '@/lib/core/answer-key';
import { ANSWER_INDEX_ARB, QUESTION_ARB, makeQuestion } from '../helpers/question';
import type { AnswerIndex } from '@/types';

describe('I1 — answer immutability', () => {
  it('isCorrect is index equality and nothing else', () => {
    const q = makeQuestion({ answer: 2 });
    expect(isCorrect(q, 0)).toBe(false);
    expect(isCorrect(q, 1)).toBe(false);
    expect(isCorrect(q, 2)).toBe(true);
    expect(isCorrect(q, 3)).toBe(false);
  });

  it('holds for every question and every index (property)', () => {
    fc.assert(
      fc.property(QUESTION_ARB, ANSWER_INDEX_ARB, (q, selected) => {
        expect(isCorrect(q, selected)).toBe(selected === correctOptionPosition(q));
      }),
      { numRuns: 500 }
    );
  });

  it('does NOT use string comparison: identical option text at another index is still incorrect', () => {
    // The whole option set is the same string. Only the index may decide.
    const q = makeQuestion({ options: ['Atrophy', 'Atrophy', 'Atrophy', 'Atrophy'], answer: 1 });
    expect(isCorrect(q, 1)).toBe(true);
    expect(isCorrect(q, 0)).toBe(false);
    expect(isCorrect(q, 2)).toBe(false);
    expect(isCorrect(q, 3)).toBe(false);
    // ...even though the text at index 0 equals the correct text exactly.
    expect(q.options[0]).toBe(correctOptionText(q));
  });

  it('correctOptionText reads positionally from the frozen tuple', () => {
    fc.assert(
      fc.property(QUESTION_ARB, (q) => {
        expect(correctOptionText(q)).toBe(q.options[correctOptionPosition(q)]);
      }),
      { numRuns: 300 }
    );
  });
});

describe('evaluate', () => {
  it('maps null to skipped', () => {
    expect(evaluate(makeQuestion(), null)).toBe('skipped');
  });

  it('maps a matching selection to correct and anything else to incorrect', () => {
    const q = makeQuestion({ answer: 3 });
    expect(evaluate(q, 3)).toBe('correct');
    expect(evaluate(q, 0)).toBe('incorrect');
  });

  it('never returns "unattempted" — that is the absence of a record, not an evaluation', () => {
    fc.assert(
      fc.property(QUESTION_ARB, fc.option(ANSWER_INDEX_ARB, { nil: null }), (q, sel) => {
        expect(evaluate(q, sel)).not.toBe('unattempted');
      }),
      { numRuns: 200 }
    );
  });

  it('agrees with isCorrect for every non-null selection', () => {
    fc.assert(
      fc.property(QUESTION_ARB, ANSWER_INDEX_ARB, (q, sel) => {
        expect(evaluate(q, sel) === 'correct').toBe(isCorrect(q, sel));
      }),
      { numRuns: 300 }
    );
  });
});

describe('toAnswerIndex — H1 normalisation', () => {
  it('converts a 1-based cop', () => {
    expect(toAnswerIndex(1, 1)).toBe(0);
    expect(toAnswerIndex(2, 1)).toBe(1);
    expect(toAnswerIndex(3, 1)).toBe(2);
    expect(toAnswerIndex(4, 1)).toBe(3);
  });

  it('passes a 0-based cop through', () => {
    expect(toAnswerIndex(0, 0)).toBe(0);
    expect(toAnswerIndex(3, 0)).toBe(3);
  });

  it('rejects the sentinel values H2 warns about rather than clamping', () => {
    // 0 in a 1-based file, and -1, are the documented "no ground truth" markers.
    expect(() => toAnswerIndex(0, 1)).toThrow(AnswerNormalisationError);
    expect(() => toAnswerIndex(-1, 1)).toThrow(AnswerNormalisationError);
    expect(() => toAnswerIndex(-1, 0)).toThrow(AnswerNormalisationError);
  });

  it('rejects out-of-range and non-integer input', () => {
    expect(() => toAnswerIndex(5, 1)).toThrow(AnswerNormalisationError);
    expect(() => toAnswerIndex(4, 0)).toThrow(AnswerNormalisationError);
    expect(() => toAnswerIndex(1.5, 0)).toThrow(/not an integer/);
    expect(() => toAnswerIndex('2', 1)).toThrow(/not an integer/);
    expect(() => toAnswerIndex(null, 1)).toThrow(/not an integer/);
    expect(() => toAnswerIndex(undefined, 1)).toThrow(/not an integer/);
    expect(() => toAnswerIndex(Number.NaN, 1)).toThrow(/not an integer/);
  });

  it('carries diagnostic context on the error', () => {
    try {
      toAnswerIndex(9, 1);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AnswerNormalisationError);
      const e = err as AnswerNormalisationError;
      expect(e.rawCop).toBe(9);
      expect(e.copIndexBase).toBe(1);
      expect(e.name).toBe('AnswerNormalisationError');
    }
  });

  it('a wrong base is caught rather than producing a plausible wrong answer', () => {
    // The H1 failure mode: reading a 1-based file as 0-based. cop=4 must throw.
    expect(() => toAnswerIndex(4, 0)).toThrow();
    // But cop=1..3 read as 0-based silently yields a WRONG index. This is why
    // the range check exists: no single record can reveal the error.
    expect(toAnswerIndex(3, 0)).toBe(3);
    expect(toAnswerIndex(3, 1)).toBe(2);
  });
});

describe('isAnswerIndex', () => {
  it('accepts exactly 0..3', () => {
    expect(ANSWER_INDICES).toEqual([0, 1, 2, 3]);
    for (const v of [0, 1, 2, 3]) expect(isAnswerIndex(v)).toBe(true);
    for (const v of [-1, 4, 1.5, '1', null, undefined, {}, [], Number.NaN]) {
      expect(isAnswerIndex(v)).toBe(false);
    }
  });

  it('ANSWER_INDICES is frozen', () => {
    expect(Object.isFrozen(ANSWER_INDICES)).toBe(true);
  });
});

describe('I3 — createQuestion returns a frozen, validated question', () => {
  it('freezes the question and its options', () => {
    const q = makeQuestion();
    expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(q.options)).toBe(true);
    expect(Object.isFrozen(q.flags)).toBe(true);
  });

  it('mutation attempts do not change the answer', () => {
    const q = makeQuestion({ answer: 2 });
    // Non-strict assignment on a frozen object throws in module (strict) code.
    expect(() => {
      (q as { answerIndex: AnswerIndex }).answerIndex = 0;
    }).toThrow();
    expect(isCorrect(q, 2)).toBe(true);
    expect(isCorrect(q, 0)).toBe(false);
  });

  it('rejects an out-of-range answer', () => {
    expect(() => makeQuestion({ answer: 7 as AnswerIndex })).toThrow(CorpusIntegrityError);
  });

  it('rejects the wrong number of options', () => {
    expect(() =>
      createQuestion({
        ...makeQuestion(),
        options: ['a', 'b', 'c'] as unknown as readonly [string, string, string, string],
        answer: 0,
      })
    ).toThrow(/expected 4 options/);
  });

  it('rejects a question whose correct option is empty', () => {
    expect(() => makeQuestion({ options: ['a', 'b', '   ', 'd'], answer: 2 })).toThrow(/correct option is empty/);
  });
});

describe('questionFromRow — fails closed on a corrupted database', () => {
  const baseRow: QuestionRow = {
    id: 'r1',
    source: 'medmcqa',
    split: 'train',
    stem: 'A sufficiently long stem for validation',
    opt_a: 'A',
    opt_b: 'B',
    opt_c: 'C',
    opt_d: 'D',
    answer_index: 1,
    explanation: null,
    subject: 'Anatomy',
    topic: null,
    choice_type: 'single',
    flags: '[]',
    duplicate_of: null,
    session_eligible: 1,
  };

  it('maps a well-formed row', () => {
    const q = questionFromRow(baseRow);
    expect(correctOptionText(q)).toBe('B');
    expect(q.sessionEligible).toBe(true);
    expect(q.flags).toEqual([]);
  });

  it('treats session_eligible other than 1 as false', () => {
    expect(questionFromRow({ ...baseRow, session_eligible: 0 }).sessionEligible).toBe(false);
  });

  it('rejects an out-of-range answer_index', () => {
    expect(() => questionFromRow({ ...baseRow, answer_index: 9 })).toThrow(CorpusIntegrityError);
    expect(() => questionFromRow({ ...baseRow, answer_index: -1 })).toThrow(/outside/);
  });

  it('rejects an unknown source, split, or choice_type', () => {
    expect(() => questionFromRow({ ...baseRow, source: 'nbme' })).toThrow(/unknown source/);
    expect(() => questionFromRow({ ...baseRow, split: 'test' })).toThrow(/unknown split/);
    expect(() => questionFromRow({ ...baseRow, choice_type: 'many' })).toThrow(/unknown choice_type/);
  });

  it('accepts a usmle-sourced row', () => {
    const q = questionFromRow({ ...baseRow, source: 'usmle' });
    expect(q.source).toBe('usmle');
  });

  it('rejects unreadable or non-array flags', () => {
    expect(() => questionFromRow({ ...baseRow, flags: 'not json' })).toThrow(/unreadable flags/);
    expect(() => questionFromRow({ ...baseRow, flags: '{"a":1}' })).toThrow(/unreadable flags/);
    expect(() => questionFromRow({ ...baseRow, flags: '[1,2]' })).toThrow(/unreadable flags/);
  });

  it('parses a valid flags array', () => {
    const q = questionFromRow({ ...baseRow, flags: '["no_topic","no_explanation"]' });
    expect(q.flags).toEqual(['no_topic', 'no_explanation']);
  });
});

describe('§3.2 answerKeyHash', () => {
  it('is a 64-character sha256 hex digest', () => {
    const h = computeAnswerKeyHash([{ id: 'a', answer: 0 }]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-independent', () => {
    const a = computeAnswerKeyHash([
      { id: 'b', answer: 1 },
      { id: 'a', answer: 0 },
    ]);
    const b = computeAnswerKeyHash([
      { id: 'a', answer: 0 },
      { id: 'b', answer: 1 },
    ]);
    expect(a).toBe(b);
  });

  it('changes when any single answer changes', () => {
    const base = computeAnswerKeyHash([
      { id: 'a', answer: 0 },
      { id: 'b', answer: 1 },
    ]);
    const mutated = computeAnswerKeyHash([
      { id: 'a', answer: 0 },
      { id: 'b', answer: 2 },
    ]);
    expect(mutated).not.toBe(base);
  });

  it('changes when an id changes', () => {
    const base = computeAnswerKeyHash([{ id: 'a', answer: 0 }]);
    expect(computeAnswerKeyHash([{ id: 'a2', answer: 0 }])).not.toBe(base);
  });

  it('is empty-safe', () => {
    expect(computeAnswerKeyHash([])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles identical entries deterministically', () => {
    // Exercises the comparator's equal branch. Duplicate ids cannot occur in a
    // validated corpus, but the hash must not depend on that holding.
    const dup = [
      { id: 'a', answer: 1 } as const,
      { id: 'a', answer: 1 } as const,
    ];
    expect(computeAnswerKeyHash(dup)).toBe(computeAnswerKeyHash([...dup].reverse()));
  });
});

describe('the browser-safe core barrel', () => {
  it('re-exports the verdict API without pulling in node:crypto', async () => {
    const barrel = await import('@/lib/core');
    expect(typeof barrel.isCorrect).toBe('function');
    expect(typeof barrel.evaluate).toBe('function');
    expect(typeof barrel.correctOptionText).toBe('function');
    expect(typeof barrel.correctOptionPosition).toBe('function');
    expect(typeof barrel.toAnswerIndex).toBe('function');
    expect(typeof barrel.createQuestion).toBe('function');
    expect(typeof barrel.questionFromRow).toBe('function');
    // `computeAnswerKeyHash` lives in answer-key.ts and must NOT be re-exported:
    // it imports node:crypto and would drag a Node builtin into the client graph.
    expect('computeAnswerKeyHash' in barrel).toBe(false);
  });
});

describe('tryToAnswerIndex — the non-throwing form', () => {
  it('mirrors toAnswerIndex on success', () => {
    expect(tryToAnswerIndex(3, 1)).toEqual({ ok: true, value: 2 });
    expect(tryToAnswerIndex(0, 0)).toEqual({ ok: true, value: 0 });
  });

  it('reports a reason instead of throwing', () => {
    const bad = tryToAnswerIndex(0, 1);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/outside \{0,1,2,3\}/);

    const nonInt = tryToAnswerIndex('x', 1);
    expect(nonInt.ok).toBe(false);
    if (!nonInt.ok) expect(nonInt.reason).toMatch(/not an integer/);
  });
});
