/**
 * `lib/parser/usmle.ts` — 100% branch coverage required (§12.3, no exceptions
 * for `lib/parser/`).
 *
 * Mirrors `tests/unit/parser.test.ts`'s style for `validateRecord`: an inline
 * record factory rather than a JSONL fixture, since these are per-branch unit
 * tests of a pure function, not a build-time integration scenario (JSONL
 * fixtures in this repo are reserved for that — see `cop-base.test.ts`'s T3).
 */

import { describe, expect, it } from 'vitest';

import {
  META_INFO_TO_SUBJECT,
  resolveUsmleLetter,
  subjectForMetaInfo,
  synthesizeUsmleId,
  validateUsmleRecord,
  type UsmleValidationContext,
} from '@/lib/parser/usmle';

// ---------------------------------------------------------------------------
// resolveUsmleLetter
// ---------------------------------------------------------------------------

describe('resolveUsmleLetter', () => {
  it('resolves A-D to 0-3', () => {
    expect(resolveUsmleLetter('A')).toEqual({ ok: true, value: 0 });
    expect(resolveUsmleLetter('B')).toEqual({ ok: true, value: 1 });
    expect(resolveUsmleLetter('C')).toEqual({ ok: true, value: 2 });
    expect(resolveUsmleLetter('D')).toEqual({ ok: true, value: 3 });
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(resolveUsmleLetter('a')).toEqual({ ok: true, value: 0 });
    expect(resolveUsmleLetter(' b ')).toEqual({ ok: true, value: 1 });
    expect(resolveUsmleLetter('\tc\n')).toEqual({ ok: true, value: 2 });
  });

  it('rejects a non-string value', () => {
    for (const v of [null, undefined, 0, 1, true, {}, []]) {
      const r = resolveUsmleLetter(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/not a string/);
    }
  });

  it('rejects anything not exactly one of A-D', () => {
    // Includes the fifth USMLE option letter this ETL deliberately never
    // ingests (the 5-option US/Mainland files are out of scope).
    for (const v of ['E', 'F', '1', '', '  ', 'AB', 'a1', '*']) {
      const r = resolveUsmleLetter(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain(v);
    }
  });
});

// ---------------------------------------------------------------------------
// subjectForMetaInfo
// ---------------------------------------------------------------------------

describe('subjectForMetaInfo', () => {
  it('maps the two known meta_info values', () => {
    expect(subjectForMetaInfo('step1')).toBe('USMLE Step 1');
    expect(subjectForMetaInfo('step2&3')).toBe('USMLE Step 2 & 3');
    expect(META_INFO_TO_SUBJECT['step1']).toBe('USMLE Step 1');
  });

  it('is case/whitespace tolerant', () => {
    expect(subjectForMetaInfo('STEP1')).toBe('USMLE Step 1');
    expect(subjectForMetaInfo('  step2&3  ')).toBe('USMLE Step 2 & 3');
  });

  it('falls open to a generic "USMLE" bucket for an unrecognised value, never rejects', () => {
    expect(subjectForMetaInfo('step4')).toBe('USMLE');
    expect(subjectForMetaInfo('')).toBe('USMLE');
  });

  it('falls open to "USMLE" for a non-string value', () => {
    expect(subjectForMetaInfo(null)).toBe('USMLE');
    expect(subjectForMetaInfo(undefined)).toBe('USMLE');
    expect(subjectForMetaInfo(42)).toBe('USMLE');
  });
});

// ---------------------------------------------------------------------------
// synthesizeUsmleId
// ---------------------------------------------------------------------------

describe('synthesizeUsmleId', () => {
  const base = {
    stem: 'A 23-year-old pregnant woman presents with burning upon urination.',
    options: ['Ampicillin', 'Ceftriaxone', 'Ciprofloxacin', 'Nitrofurantoin'] as const,
    answerLetter: 'D',
  };

  it('is deterministic: same input twice produces the same id', () => {
    expect(synthesizeUsmleId('train', base)).toBe(synthesizeUsmleId('train', base));
  });

  it('changes when the split token changes', () => {
    expect(synthesizeUsmleId('train', base)).not.toBe(synthesizeUsmleId('dev', base));
  });

  it('changes when the content changes', () => {
    const other = { ...base, stem: 'A different stem entirely.' };
    expect(synthesizeUsmleId('train', base)).not.toBe(synthesizeUsmleId('train', other));
  });

  it('field boundaries are not ambiguous: "ab"+"c" must not hash like "a"+"bc"', () => {
    const a = synthesizeUsmleId('train', { stem: 'ab', options: ['c', 'x', 'y', 'z'], answerLetter: 'A' });
    const b = synthesizeUsmleId('train', { stem: 'a', options: ['bc', 'x', 'y', 'z'], answerLetter: 'A' });
    expect(a).not.toBe(b);
  });

  it('has the expected shape and never collides with MedMCQA\'s UUID-format ids', () => {
    const id = synthesizeUsmleId('train', base);
    expect(id).toMatch(/^usmle-[0-9a-f]{24}$/);
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

// ---------------------------------------------------------------------------
// validateUsmleRecord
// ---------------------------------------------------------------------------

function usmleRecord(overrides: Record<string, unknown> = {}): unknown {
  return {
    question: 'A 23-year-old pregnant woman at 22 weeks gestation presents with burning upon urination.',
    options: { A: 'Ampicillin', B: 'Ceftriaxone', C: 'Ciprofloxacin', D: 'Nitrofurantoin' },
    answer: 'Nitrofurantoin',
    meta_info: 'step2&3',
    answer_idx: 'D',
    ...overrides,
  };
}

function ctx(over: Partial<UsmleValidationContext> = {}): UsmleValidationContext {
  return { split: 'train', seenIds: new Set<string>(), ...over };
}

describe('validateUsmleRecord', () => {
  it('accepts a well-formed record and resolves the answer positionally', () => {
    const res = validateUsmleRecord(usmleRecord(), 'train', ctx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.record.answer).toBe(3);
      expect(res.record.options[3]).toBe('Nitrofurantoin');
      expect(res.record.subject).toBe('USMLE Step 2 & 3');
      expect(res.record.explanation).toBeNull();
      expect(res.record.flags).toContain('no_explanation');
      expect(res.record.choiceType).toBe('single');
      expect(res.record.split).toBe('train');
      expect(res.record.id).toMatch(/^usmle-[0-9a-f]{24}$/);
    }
  });

  it('E_MISSING_ID for a non-object record', () => {
    for (const input of [null, undefined, 'string', 42, [], true]) {
      const r = validateUsmleRecord(input, 'train', ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_MISSING_ID');
    }
  });

  it('E_MISSING_STEM for a missing, non-string, or too-short question', () => {
    for (const question of [undefined, null, 123, 'too short']) {
      const r = validateUsmleRecord(usmleRecord({ question }), 'train', ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_MISSING_STEM');
    }
  });

  it('E_MISSING_STEM when the stem sanitises to nothing (markup-only)', () => {
    const r = validateUsmleRecord(usmleRecord({ question: '<p></p><br/>' }), 'train', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_MISSING_STEM');
  });

  it('E_OPTION_COUNT when options is missing or not an object', () => {
    for (const options of [undefined, null, 'ABCD', ['a', 'b', 'c', 'd'], 42]) {
      const r = validateUsmleRecord(usmleRecord({ options }), 'train', ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_OPTION_COUNT');
    }
  });

  it('E_OPTION_COUNT when fewer than 4 option keys are present', () => {
    const r = validateUsmleRecord(usmleRecord({ options: { A: 'x', B: 'y', C: 'z' } }), 'train', ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_OPTION_COUNT');
  });

  it('E_OPTION_EMPTY when an option is empty after sanitising', () => {
    const r = validateUsmleRecord(
      usmleRecord({ options: { A: 'Ampicillin', B: '   ', C: 'Ciprofloxacin', D: 'Nitrofurantoin' } }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('E_OPTION_EMPTY');
      expect(r.detail).toContain('B');
    }
  });

  it('E_OPTION_EMPTY when an option key is present but null (a real, representable JSON value)', () => {
    const r = validateUsmleRecord(
      usmleRecord({ options: { A: 'Ampicillin', B: 'Ceftriaxone', C: null, D: 'Nitrofurantoin' } }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('E_OPTION_EMPTY');
      expect(r.detail).toContain('C');
    }
  });

  it('E_OPTION_DISTINCT when all four options are identical', () => {
    const r = validateUsmleRecord(
      usmleRecord({ options: { A: 'Same', B: 'Same', C: 'Same', D: 'Same' } }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_OPTION_DISTINCT');
  });

  it('flags three_distinct_options when exactly 3 options are distinct', () => {
    const r = validateUsmleRecord(
      usmleRecord({ options: { A: 'Same', B: 'Same', C: 'Ciprofloxacin', D: 'Nitrofurantoin' } }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.flags).toContain('three_distinct_options');
      expect(r.record.flags).not.toContain('two_distinct_options');
    }
  });

  it('flags two_distinct_options when exactly 2 options are distinct', () => {
    const r = validateUsmleRecord(
      usmleRecord({
        options: { A: 'Same', B: 'Same', C: 'Different', D: 'Different' },
        answer_idx: 'A',
      }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.flags).toContain('two_distinct_options');
      expect(r.record.flags).not.toContain('three_distinct_options');
    }
  });

  it('E_ANSWER_MISSING when answer_idx is null or undefined', () => {
    for (const answer_idx of [null, undefined]) {
      const r = validateUsmleRecord(usmleRecord({ answer_idx }), 'train', ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_ANSWER_MISSING');
    }
  });

  it('E_ANSWER_RANGE when answer_idx does not resolve to A-D', () => {
    for (const answer_idx of ['E', '1', '', 'AB']) {
      const r = validateUsmleRecord(usmleRecord({ answer_idx }), 'train', ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_ANSWER_RANGE');
    }
  });

  it('E_DUPLICATE_ID on a byte-for-byte repeat of the same content', () => {
    const shared = ctx();
    const first = validateUsmleRecord(usmleRecord(), 'train', shared);
    expect(first.ok).toBe(true);
    const second = validateUsmleRecord(usmleRecord(), 'train', shared);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('E_DUPLICATE_ID');
  });

  it('does not collide across different split tokens (same seenIds, different splitToken)', () => {
    const shared = ctx();
    const first = validateUsmleRecord(usmleRecord(), 'train', shared);
    const second = validateUsmleRecord(usmleRecord(), 'dev', shared);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('falls back to the generic "USMLE" subject for an unrecognised meta_info', () => {
    const r = validateUsmleRecord(usmleRecord({ meta_info: 'step4' }), 'train', ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.subject).toBe('USMLE');
  });

  it('maps step1 to its own subject bucket, distinct from step2&3', () => {
    const r = validateUsmleRecord(usmleRecord({ meta_info: 'step1' }), 'train', ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.subject).toBe('USMLE Step 1');
  });

  it('flags markup_stripped when the stem contains markup', () => {
    const r = validateUsmleRecord(
      usmleRecord({ question: '<p>A 23-year-old pregnant woman presents with burning upon urination.</p>' }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.flags).toContain('markup_stripped');
  });

  it('flags markup_stripped when an option contains markup', () => {
    const r = validateUsmleRecord(
      usmleRecord({ options: { A: '<b>Ampicillin</b>', B: 'Ceftriaxone', C: 'Ciprofloxacin', D: 'Nitrofurantoin' } }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.flags).toContain('markup_stripped');
  });

  it('does not flag markup_stripped for plain text', () => {
    const r = validateUsmleRecord(usmleRecord(), 'train', ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.flags).not.toContain('markup_stripped');
  });

  it('coerces a non-string, non-nullish option value rather than crashing', () => {
    const r = validateUsmleRecord(
      usmleRecord({ options: { A: 'Ampicillin', B: 'Ceftriaxone', C: 'Ciprofloxacin', D: 12345 } }),
      'train',
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.options[3]).toBe('12345');
  });

  it('produces a stable id across an independent second validation of identical content', () => {
    const a = validateUsmleRecord(usmleRecord(), 'train', ctx());
    const b = validateUsmleRecord(usmleRecord(), 'train', ctx());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.record.id).toBe(b.record.id);
  });
});
