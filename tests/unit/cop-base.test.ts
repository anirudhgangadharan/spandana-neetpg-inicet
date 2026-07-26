/**
 * T3 — index-base regression test. "The highest-value test in the suite" (§12.1).
 *
 * Fixtures exist in both 0-based and 1-based encodings. The detector must
 * resolve each correctly and must ABORT on a heterogeneous file rather than
 * pick a winner.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  checkAnswerHistogram,
  MIN_SEMANTIC_SAMPLE,
  parseAnswerMarker,
  resolveCopIndexBase,
  type CopObservations,
} from '@/lib/parser/cop-base';
import { detectSchema } from '@/lib/parser/schema';
import { toAnswerIndex } from '@/lib/core/answer-index';

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');

function loadJsonl(name: string): Record<string, unknown>[] {
  return fs
    .readFileSync(path.join(FIXTURES, name), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Reproduce the ETL's Pass A over a fixture file. */
function observe(records: readonly Record<string, unknown>[]): CopObservations {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let nulls = 0;
  let markerComparable = 0;
  let markerAgree1 = 0;
  let markerAgree0 = 0;
  const histogram = new Map<number, number>();

  for (const r of records) {
    const cop = r['cop'];
    if (typeof cop !== 'number') {
      nulls++;
      continue;
    }
    min = Math.min(min, cop);
    max = Math.max(max, cop);
    histogram.set(cop, (histogram.get(cop) ?? 0) + 1);
    const marker = parseAnswerMarker(r['exp']);
    if (marker !== null) {
      markerComparable++;
      if (cop - 1 === marker) markerAgree1++;
      if (cop === marker) markerAgree0++;
    }
  }
  return { min, max, nulls, histogram, markerComparable, markerAgree1, markerAgree0 };
}

describe('T3 — copIndexBase resolution from fixture files', () => {
  it('resolves the 1-based fixture to base 1', () => {
    const res = resolveCopIndexBase(observe(loadJsonl('cop-1based.jsonl')));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.base).toBe(1);
  });

  it('resolves the 0-based fixture to base 0', () => {
    const res = resolveCopIndexBase(observe(loadJsonl('cop-0based.jsonl')));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.base).toBe(0);
  });

  it('ABORTS on a heterogeneous file rather than guessing', () => {
    const res = resolveCopIndexBase(observe(loadJsonl('cop-heterogeneous.jsonl')));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/heterogeneous|mixes/i);
      expect(res.report.join(' ')).toContain('[0,4]');
    }
  });

  it('the two fixtures encode the SAME answers under their own bases', () => {
    // This is the substance of the test: the same questions, two encodings, and
    // the resolved answer index must come out identical.
    const oneBased = loadJsonl('cop-1based.jsonl');
    const zeroBased = loadJsonl('cop-0based.jsonl');
    expect(oneBased).toHaveLength(zeroBased.length);

    for (let i = 0; i < oneBased.length; i++) {
      const a = oneBased[i] as Record<string, unknown>;
      const b = zeroBased[i] as Record<string, unknown>;
      expect(a['question']).toBe(b['question']);
      expect(toAnswerIndex(a['cop'], 1)).toBe(toAnswerIndex(b['cop'], 0));
    }
  });

  it('schema detection identifies cop as the answer field in both encodings', () => {
    for (const file of ['cop-1based.jsonl', 'cop-0based.jsonl']) {
      const det = detectSchema(loadJsonl(file));
      expect(det.mapping.answer).toBe('cop');
      expect(det.mapping.stem).toBe('question');
      expect(det.mapping.options).toEqual(['opa', 'opb', 'opc', 'opd']);
      expect(det.answerable).toBe(true);
    }
  });

  it('reading a 1-based fixture as 0-based throws instead of producing wrong answers', () => {
    const records = loadJsonl('cop-1based.jsonl');
    // At least one record has cop=4, which is out of range under a 0-based read.
    // This is what makes the range check definitive on its own.
    expect(records.some((r) => r['cop'] === 4)).toBe(true);
    expect(() => records.map((r) => toAnswerIndex(r['cop'], 0))).toThrow();
  });
});

describe('resolveCopIndexBase — abort conditions', () => {
  const base = (over: Partial<CopObservations>): CopObservations => ({
    min: 1,
    max: 4,
    nulls: 0,
    histogram: new Map(),
    markerComparable: 0,
    markerAgree1: 0,
    markerAgree0: 0,
    ...over,
  });

  it('aborts on an unrecognised range', () => {
    const res = resolveCopIndexBase(base({ min: 2, max: 5 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/matches no known encoding/);
  });

  it('aborts when any cop is null — ground truth is incomplete', () => {
    const res = resolveCopIndexBase(base({ nulls: 3 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/null cop/);
  });

  it('reports "n/a" rather than dividing by zero when no marker was parsed', () => {
    const res = resolveCopIndexBase(base({ markerComparable: 0 }));
    expect(res.ok).toBe(true);
    expect(res.report.join(' ')).toContain('n/a');
  });

  it('treats an infinite 0-based ratio as decisive too', () => {
    const res = resolveCopIndexBase(
      base({ min: 0, max: 3, markerComparable: 500, markerAgree0: 500, markerAgree1: 0 })
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.base).toBe(0);
      expect(res.semanticConfirmed).toBe(true);
    }
  });

  it('resolves on range alone when the semantic sample is too small, and says so', () => {
    const res = resolveCopIndexBase(base({ markerComparable: 10, markerAgree1: 10 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.base).toBe(1);
      expect(res.semanticConfirmed).toBe(false);
      expect(res.report.join(' ')).toMatch(/INSUFFICIENT SAMPLE/);
    }
  });

  it('confirms when a large semantic sample agrees with the range', () => {
    const res = resolveCopIndexBase(
      base({ markerComparable: 1000, markerAgree1: 990, markerAgree0: 2 })
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.base).toBe(1);
      expect(res.semanticConfirmed).toBe(true);
    }
  });

  it('confirms a genuinely 0-based source', () => {
    const res = resolveCopIndexBase(
      base({ min: 0, max: 3, markerComparable: 1000, markerAgree0: 990, markerAgree1: 2 })
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.base).toBe(0);
      expect(res.semanticConfirmed).toBe(true);
    }
  });

  it('ABORTS when the range and the explanations disagree', () => {
    // Range says 1-based, explanations overwhelmingly say 0-based. Refuse.
    const res = resolveCopIndexBase(
      base({ min: 1, max: 4, markerComparable: 1000, markerAgree0: 900, markerAgree1: 5 })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/refusing to guess/);
  });

  it('ABORTS when neither interpretation wins by 3:1', () => {
    const res = resolveCopIndexBase(
      base({ markerComparable: 1000, markerAgree1: 400, markerAgree0: 380 })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ambiguous/);
  });

  it('treats an infinite ratio (zero counter-evidence) as decisive', () => {
    const res = resolveCopIndexBase(
      base({ markerComparable: MIN_SEMANTIC_SAMPLE, markerAgree1: 200, markerAgree0: 0 })
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.semanticConfirmed).toBe(true);
  });
});

describe('parseAnswerMarker', () => {
  it('reads the shapes that actually occur in the corpus', () => {
    expect(parseAnswerMarker('Ans. (c) Vitamin B12')).toBe(2);
    expect(parseAnswerMarker("Ans. is 'd' i.e., Roux en Y")).toBe(3);
    expect(parseAnswerMarker('Ans. C. Deficit of expression')).toBe(2);
    expect(parseAnswerMarker('Ans) a (Abdominal aorta)')).toBe(0);
    expect(parseAnswerMarker('Ans : B (NAD+)')).toBe(1);
    expect(parseAnswerMarker('Answer is A, B, and C')).toBe(0);
    expect(parseAnswerMarker('Ans-D')).toBe(3);
    expect(parseAnswerMarker('Ans. is b\' i.e., Mean-Mode')).toBe(1);
  });

  it('does not read a word beginning with a/b/c/d as the answer letter', () => {
    // Without the trailing guard, "Adenosine" would be read as answer A.
    expect(parseAnswerMarker('Ans. Adenosine deaminase deficiency')).toBeNull();
    expect(parseAnswerMarker('Ans. Bilirubin is conjugated')).toBeNull();
  });

  it('returns null for absent or unusable input', () => {
    expect(parseAnswerMarker(null)).toBeNull();
    expect(parseAnswerMarker(undefined)).toBeNull();
    expect(parseAnswerMarker(42)).toBeNull();
    expect(parseAnswerMarker('')).toBeNull();
    expect(parseAnswerMarker('No marker in this explanation at all.')).toBeNull();
  });

  it('only looks at the head of the explanation', () => {
    const long = `${'x'.repeat(400)} Ans. (b) something`;
    expect(parseAnswerMarker(long)).toBeNull();
  });
});

describe('§5.3 assertion 4 — answer-index histogram', () => {
  it('accepts the real corpus distribution, which is genuinely biased toward A', () => {
    const res = checkAnswerHistogram([29360, 26160, 23200, 21280]);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('A=29');
  });

  it('rejects the off-by-one signature: one index near-empty', () => {
    const res = checkAnswerHistogram([0, 40000, 30000, 30000]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/off-by-one/);
  });

  it('rejects one index holding more than 40%', () => {
    expect(checkAnswerHistogram([50000, 20000, 20000, 10000]).ok).toBe(false);
  });

  it('rejects an empty corpus', () => {
    const res = checkAnswerHistogram([0, 0, 0, 0]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/empty/);
  });

  it('accepts a perfectly uniform distribution', () => {
    expect(checkAnswerHistogram([25, 25, 25, 25]).ok).toBe(true);
  });
});
