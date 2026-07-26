/**
 * §5 parser: schema detection, validation, CSV, dedupe, corruption lexicon.
 * 100% branch coverage required (§12.3).
 */

import { describe, expect, it } from 'vitest';

import { detectSchema, MIN_SCHEMA_CONFIDENCE } from '@/lib/parser/schema';
import { validateRecord, MIN_STEM_LENGTH, type ValidationContext } from '@/lib/parser/validate';
import { csvToRecords, parseCsvRows } from '@/lib/parser/csv';
import { DuplicateIndex, duplicateKey, normaliseForDuplicateKey } from '@/lib/parser/dedupe';
import {
  buildCorruptionLexicon,
  corruptedForms,
  countTokensInto,
  detectCorruption,
  tokenise,
} from '@/lib/parser/corruption';
import type { Split } from '@/types';

// ---------------------------------------------------------------------------
// §5.1 schema detection
// ---------------------------------------------------------------------------

const medmcqaRecord = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `id-${Math.random().toString(36).slice(2)}`,
  question: 'Which of the following is the commonest cancer of the oral cavity in adults?',
  opa: 'Adenocarcinoma',
  opb: 'Squamous cell carcinoma',
  opc: 'Melanoma',
  opd: 'Lymphoma',
  cop: 2,
  exp: 'Squamous cell carcinoma is the commonest oral malignancy.',
  subject_name: 'Pathology',
  topic_name: 'Oral cavity',
  choice_type: 'single',
  ...over,
});

const sampleOf = (n: number, over: Record<string, unknown> = {}): Record<string, unknown>[] =>
  Array.from({ length: n }, () => medmcqaRecord(over));

describe('detectSchema', () => {
  it('identifies MedMCQA roles with full confidence', () => {
    const det = detectSchema(sampleOf(50));
    expect(det.mapping).toMatchObject({
      id: 'id',
      stem: 'question',
      options: ['opa', 'opb', 'opc', 'opd'],
      answer: 'cop',
      explanation: 'exp',
      subject: 'subject_name',
      topic: 'topic_name',
      choiceType: 'choice_type',
    });
    expect(det.answerable).toBe(true);
    expect(det.confidence).toBeGreaterThanOrEqual(MIN_SCHEMA_CONFIDENCE);
  });

  it('infers structurally when the key names are unfamiliar', () => {
    // No name prior matches these; only structure can identify them.
    const rows = Array.from({ length: 60 }, (_, i) => ({
      uid: `u${i}`,
      prompt: 'A long stem field that is clearly the longest consistently present string value here.',
      c1: 'alpha',
      c2: 'bravo',
      c3: 'charlie',
      c4: 'delta',
      key: (i % 4) + 1,
    }));
    const det = detectSchema(rows);
    expect(det.mapping.stem).toBe('prompt');
    expect(det.mapping.options).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(det.mapping.answer).toBe('key');
  });

  it('flags a source with no answer field as unanswerable rather than low-confidence (H2)', () => {
    const det = detectSchema(sampleOf(50, { cop: undefined, exp: undefined }).map((r) => {
      const { cop: _cop, exp: _exp, ...rest } = r;
      return rest;
    }));
    expect(det.answerable).toBe(false);
    expect(det.confidence).toBeGreaterThanOrEqual(MIN_SCHEMA_CONFIDENCE);
    expect(det.reasons.join(' ')).toMatch(/unanswerable/);
  });

  it('returns zero confidence for an empty or non-object sample', () => {
    expect(detectSchema([]).confidence).toBe(0);
    expect(detectSchema([1, 'x', null]).confidence).toBe(0);
    expect(detectSchema([]).reasons.join(' ')).toMatch(/no object records/);
  });

  it('loses confidence when there are not four option fields', () => {
    const rows = Array.from({ length: 20 }, () => ({
      id: 'x',
      question: 'A stem that is long enough to be identified as the stem field here.',
      opa: 'a',
      opb: 'b',
      cop: 1,
    }));
    const det = detectSchema(rows);
    expect(det.confidence).toBeLessThan(MIN_SCHEMA_CONFIDENCE);
    expect(det.reasons.join(' ')).toMatch(/option fields/);
  });

  it('loses confidence when no id field is present', () => {
    const rows = sampleOf(20).map((r) => {
      const { id: _id, ...rest } = r;
      return rest;
    });
    expect(detectSchema(rows).reasons.join(' ')).toMatch(/no id field/);
  });

  it('records an ambiguous answer field when two integers score equally', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      ...medmcqaRecord(),
      cop: undefined,
      alpha: (i % 4) + 1,
      beta: (i % 4) + 1,
    }));
    const det = detectSchema(rows);
    expect(det.reasons.join(' ')).toMatch(/ambiguous/);
  });

  it('reports no stem candidate when nothing is consistently a string', () => {
    const det = detectSchema([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(det.mapping.stem).toBeNull();
    expect(det.reasons.join(' ')).toMatch(/no stem candidate/);
  });

  it('falls back to length correlation when the keys are not an a/b/c/d enumeration', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      // A realistically long id, so it is not itself length-similar to the
      // options — otherwise the fallback is genuinely ambiguous, which is the
      // point of preferring the enumeration signal whenever one exists.
      id: `f47ac10b-58cc-4372-a567-0e02b2c3d4${String(i).padStart(2, '0')}`,
      question: 'A stem long enough to be detected as the stem field in this record.',
      first: 'alpha',
      second: 'bravo',
      third: 'gamma',
      fourth: 'delta',
      cop: (i % 4) + 1,
    }));
    const det = detectSchema(rows);
    expect(det.mapping.options).toEqual(['first', 'fourth', 'second', 'third']);
    expect(det.reasons.join(' ')).toMatch(/length correlation/);
  });

  it('does not mistake a short explanation for an option field', () => {
    // Regression: an asymmetric length-similarity metric let a short `exp`
    // outscore the real options. Only a large corpus (where explanations are
    // long) hid the bug.
    const rows = Array.from({ length: 30 }, () => medmcqaRecord({ exp: 'Short.' }));
    expect(detectSchema(rows).mapping.options).toEqual(['opa', 'opb', 'opc', 'opd']);
  });

  it('reports an ambiguous stem when two string fields are near-equally long', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      uid: `u${i}`,
      narrative_one: 'A field of roughly this particular length, give or take a word.',
      narrative_two: 'A field of roughly that particular length, give or take a word!',
      c1: 'a',
      c2: 'b',
      c3: 'c',
      c4: 'd',
    }));
    expect(detectSchema(rows).reasons.join(' ')).toMatch(/stem ambiguous/);
  });

  it('reports a boundary-ambiguous option set when the fallback has a tie', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `f47ac10b-58cc-4372-a567-0e02b2c3d4${String(i).padStart(2, '0')}`,
      question: 'A stem long enough to be detected as the stem field in this record.',
      first: 'alpha',
      second: 'bravo',
      third: 'gamma',
      fourth: 'delta',
      fifth: 'kappa', // a fifth equally-plausible candidate: the cut is arbitrary
      cop: (i % 4) + 1,
    }));
    const det = detectSchema(rows);
    expect(det.reasons.join(' ')).toMatch(/ambiguous at the boundary/);
    expect(det.confidence).toBeLessThan(1);
  });

  it('profiles boolean and non-integer numeric fields without counting them as answers', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      ...medmcqaRecord(),
      verified: i % 2 === 0,
      difficulty_score: i + 0.5, // never an integer
    }));
    const det = detectSchema(rows);
    expect(det.mapping.answer).toBe('cop');
    expect(det.profile['verified']?.intRate).toBe(0);
    expect(det.profile['difficulty_score']?.intMin).toBeNull();
  });

  it('ignores an integer field whose range is nothing like an answer index', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      ...medmcqaRecord(),
      cop: undefined,
      year_published: 2000 + (i % 20),
    }));
    expect(detectSchema(rows).mapping.answer).toBeNull();
    expect(detectSchema(rows).answerable).toBe(false);
  });

  it('recognises other enumeration shapes', () => {
    const make = (keys: readonly string[]): Record<string, unknown>[] =>
      Array.from({ length: 20 }, (_, i) => ({
        id: `i${i}`,
        question: 'A stem long enough to be detected as the stem field in this record.',
        cop: (i % 4) + 1,
        ...Object.fromEntries(keys.map((k, j) => [k, `value ${j}`])),
      }));
    expect(detectSchema(make(['option_a', 'option_b', 'option_c', 'option_d'])).mapping.options).toEqual([
      'option_a',
      'option_b',
      'option_c',
      'option_d',
    ]);
    expect(detectSchema(make(['choice1', 'choice2', 'choice3', 'choice4'])).mapping.options).toEqual([
      'choice1',
      'choice2',
      'choice3',
      'choice4',
    ]);
  });
});

// ---------------------------------------------------------------------------
// §5.2 validation
// ---------------------------------------------------------------------------

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    mapping: detectSchema(sampleOf(20)).mapping,
    copIndexBase: 1,
    split: 'train' as Split,
    sourceAnswerable: true,
    seenIds: new Set<string>(),
    corruptionLexicon: new Set<string>(['hypeension', 'aery']),
    ...over,
  };
}

describe('validateRecord — §5.2 rules in order', () => {
  it('accepts a well-formed record and normalises the answer', () => {
    const res = validateRecord(medmcqaRecord({ id: 'ok-1', cop: 2 }), ctx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.record.answer).toBe(1);
      expect(res.record.options[1]).toBe('Squamous cell carcinoma');
      expect(res.record.subject).toBe('Pathology');
      expect(res.record.flags).toEqual([]);
    }
  });

  it('E_MISSING_ID for a non-object, an absent id, or an empty id', () => {
    for (const input of [null, 'string', 42, []]) {
      const r = validateRecord(input, ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_MISSING_ID');
    }
    const r2 = validateRecord(medmcqaRecord({ id: '   ' }), ctx());
    if (!r2.ok) expect(r2.code).toBe('E_MISSING_ID');
  });

  it('E_DUPLICATE_ID on the second sighting', () => {
    const c = ctx();
    expect(validateRecord(medmcqaRecord({ id: 'dup' }), c).ok).toBe(true);
    const second = validateRecord(medmcqaRecord({ id: 'dup' }), c);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('E_DUPLICATE_ID');
  });

  it('E_MISSING_STEM measured AFTER sanitising, so a markup-only stem is empty', () => {
    const short = validateRecord(medmcqaRecord({ id: 's1', question: 'Too short' }), ctx());
    if (!short.ok) expect(short.code).toBe('E_MISSING_STEM');

    // 40 characters of markup sanitise down to nothing.
    const markupOnly = validateRecord(medmcqaRecord({ id: 's2', question: '<p></p><br/><span></span>' }), ctx());
    expect(markupOnly.ok).toBe(false);
    if (!markupOnly.ok) expect(markupOnly.code).toBe('E_MISSING_STEM');

    const nullStem = validateRecord(medmcqaRecord({ id: 's3', question: null }), ctx());
    if (!nullStem.ok) expect(nullStem.code).toBe('E_MISSING_STEM');

    expect(MIN_STEM_LENGTH).toBe(10);
  });

  it('E_OPTION_COUNT when the schema or the record lacks four options', () => {
    const thinMapping = { ...ctx().mapping, options: ['opa', 'opb'] };
    const r = validateRecord(medmcqaRecord({ id: 'o1' }), ctx({ mapping: thinMapping }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_OPTION_COUNT');

    const rec = medmcqaRecord({ id: 'o2' });
    delete rec['opd'];
    const r2 = validateRecord(rec, ctx());
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('E_OPTION_COUNT');
  });

  it('E_OPTION_EMPTY for an option that is empty after sanitising', () => {
    const r = validateRecord(medmcqaRecord({ id: 'e1', opc: '   ' }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('E_OPTION_EMPTY');
      expect(r.detail).toContain('C');
    }
  });

  it('E_OPTION_DISTINCT when fewer than two distinct options remain (H7)', () => {
    const r = validateRecord(
      medmcqaRecord({ id: 'd1', opa: 'same', opb: 'same', opc: 'same', opd: 'same' }),
      ctx()
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_OPTION_DISTINCT');
  });

  it('E_ANSWER_UNRESOLVED for a source whose ground truth is withheld (H2)', () => {
    const r = validateRecord(medmcqaRecord({ id: 'u1' }), ctx({ sourceAnswerable: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_ANSWER_UNRESOLVED');

    const noAnswerKey = validateRecord(
      medmcqaRecord({ id: 'u2' }),
      ctx({ mapping: { ...ctx().mapping, answer: null } })
    );
    if (!noAnswerKey.ok) expect(noAnswerKey.code).toBe('E_ANSWER_UNRESOLVED');
  });

  it('E_ANSWER_MISSING for a null cop', () => {
    const r = validateRecord(medmcqaRecord({ id: 'a1', cop: null }), ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_ANSWER_MISSING');
  });

  it('E_ANSWER_RANGE catches the H2 sentinels rather than clamping them', () => {
    for (const cop of [0, -1, 5, 1.5, 'two']) {
      const r = validateRecord(medmcqaRecord({ id: `r-${String(cop)}`, cop }), ctx());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_ANSWER_RANGE');
    }
  });

  it('attaches warning flags without rejecting', () => {
    const r = validateRecord(
      medmcqaRecord({
        id: 'w1',
        exp: null,
        topic_name: null,
        choice_type: 'multi',
        opc: 'Squamous cell carcinoma', // 3 distinct
        question: 'Chronic hypeension of the aery is a risk factor for which condition?',
      }),
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.flags).toContain('no_explanation');
      expect(r.record.flags).toContain('no_topic');
      expect(r.record.flags).toContain('multi_choice_type');
      expect(r.record.flags).toContain('three_distinct_options');
      expect(r.record.flags).toContain('possible_text_corruption');
      expect(r.record.corruptedTokens).toEqual(['hypeension', 'aery']);
    }
  });

  it('flags two distinct options (D-011: the spec flags 3 but not 2)', () => {
    const r = validateRecord(medmcqaRecord({ id: 't2', opa: 'x', opb: 'x', opc: 'y', opd: 'y' }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.flags).toContain('two_distinct_options');
  });

  it('flags markup and strips it from the stored text (H8)', () => {
    const r = validateRecord(
      medmcqaRecord({ id: 'm1', question: '<p>Which organism causes leptospirosis in humans?</p>' }),
      ctx()
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.flags).toContain('markup_stripped');
      expect(r.record.stem).toBe('Which organism causes leptospirosis in humans?');
    }
  });

  it('treats a missing subject as the literal "Unknown" bucket (D-008)', () => {
    const r = validateRecord(medmcqaRecord({ id: 'n1', subject_name: null }), ctx());
    if (r.ok) expect(r.record.subject).toBe('Unknown');
  });

  it('normalises an unrecognised choice_type to "single" (H3)', () => {
    const r = validateRecord(medmcqaRecord({ id: 'c1', choice_type: 'weird' }), ctx());
    if (r.ok) expect(r.record.choiceType).toBe('single');
    const r2 = validateRecord(medmcqaRecord({ id: 'c2', choice_type: null }), ctx());
    if (r2.ok) expect(r2.record.choiceType).toBe('single');
  });

  it('coerces non-string field values rather than crashing', () => {
    const r = validateRecord(medmcqaRecord({ id: 12345, subject_name: 7 }), ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.id).toBe('12345');
      expect(r.record.subject).toBe('7');
    }
  });

  it('tolerates a mapping with no explanation, topic, subject or choiceType key', () => {
    const bare = {
      ...ctx().mapping,
      explanation: null,
      topic: null,
      subject: null,
      choiceType: null,
    };
    const r = validateRecord(medmcqaRecord({ id: 'bare-1' }), ctx({ mapping: bare }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.explanation).toBeNull();
      expect(r.record.topic).toBeNull();
      expect(r.record.subject).toBe('Unknown');
      expect(r.record.choiceType).toBe('single');
      expect(r.record.flags).toContain('no_explanation');
      expect(r.record.flags).toContain('no_topic');
    }
  });

  it('E_MISSING_ID when the id key is absent from the record entirely', () => {
    const rec = medmcqaRecord();
    delete rec['id'];
    const r = validateRecord(rec, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_MISSING_ID');
  });

  it('works with a 0-based source', () => {
    const r = validateRecord(medmcqaRecord({ id: 'z1', cop: 0 }), ctx({ copIndexBase: 0 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.answer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('csv', () => {
  it('parses quoting, doubled quotes, CRLF and embedded newlines', () => {
    const rows = parseCsvRows('a,b\r\n"x,1","he said ""hi"""\n"multi\nline",z\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    const rows = parseCsvRows(`${String.fromCharCode(0xfeff)}a,b\n1,2\n`);
    expect(rows[0]).toEqual(['a', 'b']);
  });

  it('handles a file with no trailing newline', () => {
    expect(parseCsvRows('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns no records for empty input', () => {
    expect(csvToRecords('')).toEqual([]);
    expect(parseCsvRows('')).toEqual([]);
  });

  it('keeps single-column rows and drops the empty trailing row', () => {
    expect(parseCsvRows('a\n1\n2\n')).toEqual([['a'], ['1'], ['2']]);
    expect(parseCsvRows('a\n\n1\n')).toEqual([['a'], ['1']]);
  });

  it('maps cells to records, empties to null and integers to numbers', () => {
    const recs = csvToRecords('id,question,cop,topic_name\nq1,"A stem",3,\n');
    expect(recs).toEqual([{ id: 'q1', question: 'A stem', cop: 3, topic_name: null }]);
  });

  it('pads records whose row is shorter than the header', () => {
    const recs = csvToRecords('a,b,c\n1,2\n');
    expect(recs[0]).toEqual({ a: 1, b: 2, c: null });
  });

  it('leaves long digit strings as strings rather than losing precision', () => {
    const recs = csvToRecords('a\n12345678901234567890\n');
    expect(recs[0]?.['a']).toBe('12345678901234567890');
  });

  it('feeds detectSchema correctly from a parquet-style CSV export', () => {
    const csv =
      'id,question,opa,opb,opc,opd,cop,exp,subject_name,topic_name,choice_type\n' +
      Array.from({ length: 20 }, (_, i) =>
        `c${i},"A stem long enough to be detected as the stem",alpha,bravo,charlie,delta,${(i % 4) + 1},"exp",Anatomy,,single`
      ).join('\n');
    const det = detectSchema(csvToRecords(csv));
    expect(det.mapping.answer).toBe('cop');
    expect(det.mapping.options).toEqual(['opa', 'opb', 'opc', 'opd']);
  });
});

// ---------------------------------------------------------------------------
// H6 / H9 dedupe
// ---------------------------------------------------------------------------

describe('dedupe', () => {
  it('normalisation collapses punctuation, case and escaping', () => {
    expect(normaliseForDuplicateKey('Pearsonian measure of skewness -')).toBe('pearsonian measure of skewness');
    expect(normaliseForDuplicateKey('Pearsonian measure of skewness-')).toBe('pearsonian measure of skewness');
    expect(normaliseForDuplicateKey('Mean - Mode\\/SD')).toBe('mean mode sd');
    expect(normaliseForDuplicateKey(null)).toBe('');
    expect(normaliseForDuplicateKey('<p>Tag</p>')).toBe('tag');
  });

  it('option order does not change the key', () => {
    const a = duplicateKey('Glucose symport occurs with', ['Na+', 'K+', 'Ca++', 'Cl-']);
    const b = duplicateKey('Glucose symport occurs with', ['Na+', 'Ca++', 'K+', 'Cl-']);
    expect(a).toBe(b);
  });

  it('different questions produce different keys', () => {
    expect(duplicateKey('Question one here', ['a', 'b', 'c', 'd'])).not.toBe(
      duplicateKey('Question two here', ['a', 'b', 'c', 'd'])
    );
  });

  it('tracks canonical membership and redundancy', () => {
    const idx = new DuplicateIndex();
    idx.add('k1', 'first', 2);
    idx.add('k1', 'second', 2);
    idx.add('k2', 'lonely', 0);

    expect(idx.duplicateOf('k1', 'first')).toBeNull();
    expect(idx.duplicateOf('k1', 'second')).toBe('first');
    expect(idx.duplicateOf('k2', 'lonely')).toBeNull();
    expect(idx.duplicateOf('missing', 'x')).toBeNull();
    expect(idx.get('k1')?.memberIds).toEqual(['first', 'second']);
    expect(idx.get('nope')).toBeUndefined();

    const s = idx.stats();
    expect(s).toEqual({ groups: 2, redundant: 1, conflictingGroups: 0, conflictingRecords: 0 });
  });

  it('H9 — detects a duplicate group whose members disagree about the answer', () => {
    const idx = new DuplicateIndex();
    idx.add('k', 'a', 1);
    idx.add('k', 'b', 3); // same question, different answer: one of these is wrong
    expect(idx.hasConflictingAnswers('k')).toBe(true);
    expect(idx.hasConflictingAnswers('other')).toBe(false);
    expect(idx.stats()).toMatchObject({ conflictingGroups: 1, conflictingRecords: 2 });
  });
});

// ---------------------------------------------------------------------------
// H4 corruption lexicon
// ---------------------------------------------------------------------------

describe('corruption lexicon', () => {
  it('enumerates every rt-deletion of a token', () => {
    expect(corruptedForms('artery')).toEqual(['aery']);
    expect(corruptedForms('hypertension')).toEqual(['hypeension']);
    expect(corruptedForms('quarterly')).toEqual(['quaerly']);
    expect(corruptedForms('shortport')).toEqual(['shoport', 'shortpo']);
    expect(corruptedForms('kidney')).toEqual([]);
  });

  it('tokenises to lowercase alphabetic runs', () => {
    expect(tokenise('Renal Artery, 25-hydroxy!')).toEqual(['renal', 'artery', 'hydroxy']);
    expect(tokenise('12345')).toEqual([]);
  });

  it('counts tokens into an accumulator', () => {
    const counts = new Map<string, number>();
    countTokensInto(counts, 'artery artery vein');
    expect(counts.get('artery')).toBe(2);
    expect(counts.get('vein')).toBe(1);
  });

  it('derives pairs where both forms coexist and the corrupted form is long enough', () => {
    const counts = new Map<string, number>([
      ['artery', 500],
      ['aery', 900], // the corrupted form DOMINATES — see the note below
      ['hypertension', 300],
      ['hypeension', 20],
      ['kidney', 900], // contains no "rt"
      ['important', 100],
      ['impoant', 1], // below minCorruptFreq
      ['part', 400],
      ['pa', 900], // shorter than minCorruptLength
      ['sort', 200],
      ['so', 5000], // shorter than minCorruptLength
      ['rare', 3], // intact form below minIntactFreq
      ['e', 3],
    ]);
    const lex = buildCorruptionLexicon(counts);
    const corrupted = lex.map((e) => e.corrupted);
    expect(corrupted).toContain('aery');
    expect(corrupted).toContain('hypeension');
    expect(corrupted).not.toContain('impoant');
    expect(corrupted).not.toContain('pa');
    expect(corrupted).not.toContain('so');
    expect(corrupted).not.toContain('e');
    // Sorted by corrupted frequency, descending.
    expect(lex[0]?.corrupted).toBe('aery');
  });

  it('does NOT require the corruption to be rarer than its source (D-017 regression)', () => {
    // In the real corpus "aery" outnumbers "artery" 11,511 to 7,151: the defect is
    // the majority spelling of the words it touches. An earlier heuristic assumed
    // the opposite and silently dropped the ten most frequent corruptions.
    const lex = buildCorruptionLexicon(
      new Map([
        ['artery', 7151],
        ['aery', 11511],
        ['hypertension', 2554],
        ['hypeension', 4129],
      ])
    );
    expect(lex.map((e) => e.corrupted)).toEqual(['aery', 'hypeension']);
  });

  it('suppresses the reviewed real-word collisions by default', () => {
    // "main" is an rt-deletion of "martin" and also an extremely common word.
    const lex = buildCorruptionLexicon(
      new Map([
        ['martin', 73],
        ['main', 3362],
        ['startle', 25],
        ['stale', 51],
      ])
    );
    expect(lex).toHaveLength(0);
  });

  it('keeps the most frequent intact source when several map to one corruption', () => {
    const counts = new Map<string, number>([
      ['convert', 900],
      ['converts', 40],
      ['conve', 300],
      ['conves', 10],
    ]);
    const lex = buildCorruptionLexicon(counts);
    const entry = lex.find((e) => e.corrupted === 'conve');
    expect(entry?.intact).toBe('convert');
  });

  it('honours custom thresholds', () => {
    const counts = new Map<string, number>([
      ['artery', 5],
      ['aery', 2],
    ]);
    expect(buildCorruptionLexicon(counts)).toHaveLength(0);
    const lex = buildCorruptionLexicon(counts, { minIntactFreq: 4, minCorruptFreq: 1, minCorruptLength: 3 });
    expect(lex.map((e) => e.corrupted)).toContain('aery');
  });

  it('skips a corrupted form that never occurs in the corpus', () => {
    // `aery` is absent, so `artery` yields no pair even though it contains "rt".
    const lex = buildCorruptionLexicon(new Map([['artery', 500]]));
    expect(lex).toHaveLength(0);
  });

  it('keeps the most frequent intact form when two words yield the same corruption', () => {
    // Synthetic tokens: deleting "rt" from either "xrty" or "xyrt" gives "xy".
    // Real English rarely collides this way, but the resolution rule must hold.
    const counts = new Map<string, number>([
      ['xrty', 900],
      ['xyrt', 50],
      ['xy', 30],
    ]);
    const lex = buildCorruptionLexicon(counts, { minCorruptLength: 2 });
    expect(lex.find((e) => e.corrupted === 'xy')?.intact).toBe('xrty');

    // ...and the same holds when the rarer source is encountered first, so the
    // result does not depend on map iteration order.
    const reversed = new Map<string, number>([
      ['xyrt', 50],
      ['xrty', 900],
      ['xy', 30],
    ]);
    const lex2 = buildCorruptionLexicon(reversed, { minCorruptLength: 2 });
    expect(lex2.find((e) => e.corrupted === 'xy')?.intact).toBe('xrty');
    expect(lex2.find((e) => e.corrupted === 'xy')?.intactFreq).toBe(900);
  });

  it('honours an injected allowlist so an ambiguous form can be suppressed', () => {
    const counts = new Map<string, number>([
      ['arterial', 500],
      ['aerial', 60],
    ]);
    expect(buildCorruptionLexicon(counts).map((e) => e.corrupted)).toContain('aerial');
    const suppressed = buildCorruptionLexicon(counts, { allowlist: new Set(['aerial']) });
    expect(suppressed).toHaveLength(0);
  });

  it('breaks frequency ties by corrupted form for a stable ordering', () => {
    const counts = new Map<string, number>([
      ['artery', 500],
      ['aery', 40],
      ['portal', 500],
      ['poal', 40],
    ]);
    const lex = buildCorruptionLexicon(counts);
    expect(lex.map((e) => e.corrupted)).toEqual(['aery', 'poal']);
  });

  it('detects corrupted tokens in text, deduplicated and in order', () => {
    const lex = new Set(['aery', 'hypeension']);
    expect(detectCorruption('The aery shows hypeension and the aery is narrow', lex)).toEqual([
      'aery',
      'hypeension',
    ]);
    expect(detectCorruption('Perfectly ordinary medical text', lex)).toEqual([]);
  });
});
