/**
 * ⚠ TRUSTED COMPUTING BASE — `lib/core/` (spec §6).
 * Pure and synchronous. `node:crypto`'s hash API performs no I/O and is not
 * async; this module is nonetheless kept separate from the browser-facing core
 * so bundlers never pull a Node builtin into the client graph.
 *
 * §3.2 integrity checksum: the ETL writes `answerKeyHash` into manifest.json,
 * and the server recomputes it from the database at startup. A mismatch makes
 * the app refuse to serve questions. This makes silent corruption of the answer
 * key impossible to miss.
 */

import { createHash } from 'node:crypto';
import type { AnswerIndex } from '@/types';

export interface AnswerKeyEntry {
  readonly id: string;
  readonly answer: AnswerIndex;
}

/**
 * `sha256(sorted(id + ':' + answerIndex))`.
 *
 * Sorting is by the composed `id:index` string under a fixed, locale-independent
 * ordering so the hash is deterministic across platforms — `Array.prototype.sort`
 * with no comparator is already locale-independent for these ASCII-safe strings,
 * but the comparator is written explicitly rather than relied upon implicitly.
 */
export function computeAnswerKeyHash(entries: Iterable<AnswerKeyEntry>): string {
  const composed: string[] = [];
  for (const e of entries) composed.push(`${e.id}:${e.answer}`);
  composed.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const h = createHash('sha256');
  for (const line of composed) {
    h.update(line);
    h.update('\n');
  }
  return h.digest('hex');
}
