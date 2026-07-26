/**
 * §7 — deterministic seeded randomness.
 * `Math.random()` is forbidden in session generation (§13 anti-requirement 7);
 * these tests are what make that constraint meaningful.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mulberry32, nextInt, sampleWithoutReplacement, seedFromString, shuffle } from '@/lib/utils/rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const sa = Array.from({ length: 20 }, () => a());
    const sb = Array.from({ length: 20 }, () => b());
    expect(sa).not.toEqual(sb);
  });

  it('stays within [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const r = mulberry32(seed);
        for (let i = 0; i < 50; i++) {
          const v = r();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('seedFromString', () => {
  it('is stable and unsigned', () => {
    expect(seedFromString('session-a')).toBe(seedFromString('session-a'));
    expect(seedFromString('session-a')).not.toBe(seedFromString('session-b'));
    expect(seedFromString('')).toBeGreaterThanOrEqual(0);
    fc.assert(
      fc.property(fc.string(), (s) => {
        const v = seedFromString(s);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      })
    );
  });
});

describe('nextInt', () => {
  it('stays in range', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = nextInt(r, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('returns 0 for an empty range', () => {
    expect(nextInt(mulberry32(1), 0)).toBe(0);
    expect(nextInt(mulberry32(1), -5)).toBe(0);
  });
});

describe('shuffle', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it('is a permutation — no loss, no duplication', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const out = shuffle(items, mulberry32(seed));
        expect(out).toHaveLength(items.length);
        expect([...out].sort((a, b) => a - b)).toEqual(items);
      }),
      { numRuns: 200 }
    );
  });

  it('is reproducible for the same seed — this is what makes a session resumable', () => {
    expect(shuffle(items, mulberry32(99))).toEqual(shuffle(items, mulberry32(99)));
  });

  it('does not mutate its input', () => {
    const original = [...items];
    shuffle(items, mulberry32(3));
    expect(items).toEqual(original);
  });

  it('handles empty and single-element inputs', () => {
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle(['x'], mulberry32(1))).toEqual(['x']);
  });

  it('actually reorders for most seeds', () => {
    const changed = Array.from({ length: 20 }, (_, s) => shuffle(items, mulberry32(s))).filter(
      (out) => out.join() !== items.join()
    );
    expect(changed.length).toBe(20);
  });
});

describe('sampleWithoutReplacement', () => {
  const items = Array.from({ length: 100 }, (_, i) => i);

  it('returns exactly `count` distinct items', () => {
    const out = sampleWithoutReplacement(items, 10, mulberry32(5));
    expect(out).toHaveLength(10);
    expect(new Set(out).size).toBe(10);
  });

  it('returns a full permutation when count meets or exceeds the pool', () => {
    expect(sampleWithoutReplacement(items, 100, mulberry32(1))).toHaveLength(100);
    expect(sampleWithoutReplacement(items, 500, mulberry32(1))).toHaveLength(100);
  });

  it('clamps a negative count to empty', () => {
    expect(sampleWithoutReplacement(items, -3, mulberry32(1))).toEqual([]);
  });

  it('is reproducible', () => {
    expect(sampleWithoutReplacement(items, 25, mulberry32(42))).toEqual(
      sampleWithoutReplacement(items, 25, mulberry32(42))
    );
  });
});
