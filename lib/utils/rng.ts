/**
 * Deterministic seeded randomness (§7).
 *
 * `Math.random()` is forbidden in session generation (§13 anti-requirement 7).
 * Every randomised sequence in this app derives from a seed stored in the
 * session, which makes exam sessions reproducible, resumable after a refresh,
 * and testable.
 *
 * Pure and total. No I/O, no async, no global state.
 */

/** mulberry32 — small, fast, and adequate for shuffling a question list. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a stable 32-bit seed from a string (e.g. a session config fingerprint). */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Integer in [0, maxExclusive). Returns 0 when the range is empty. */
export function nextInt(rand: () => number, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  return Math.floor(rand() * maxExclusive) % maxExclusive;
}

/**
 * Fisher–Yates, out of place. Same seed and same input always produce the same
 * output — this is what makes `/api/session/plan` a pure function of its config.
 */
export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(rand, i + 1);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** First `count` items of a seeded shuffle. Never returns duplicates. */
export function sampleWithoutReplacement<T>(items: readonly T[], count: number, rand: () => number): T[] {
  if (count >= items.length) return shuffle(items, rand);
  return shuffle(items, rand).slice(0, Math.max(0, count));
}
