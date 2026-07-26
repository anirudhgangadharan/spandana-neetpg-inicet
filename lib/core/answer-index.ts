/**
 * ⚠ TRUSTED COMPUTING BASE — `lib/core/` (spec §6).
 * Pure TypeScript. Zero React, zero Zustand, zero I/O, zero async.
 *
 * The single point at which a raw dataset `cop` becomes an internal answer index.
 * The conversion happens exactly ONCE in the whole system, here, called from the
 * ETL, and is asserted immediately (H1 step 5).
 */

import type { AnswerIndex } from '@/types';

export const ANSWER_INDICES: readonly AnswerIndex[] = Object.freeze([0, 1, 2, 3] as const);

/** Total, deterministic, side-effect free. */
export function isAnswerIndex(value: unknown): value is AnswerIndex {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/**
 * Raised when a `cop` cannot be normalised. The ETL turns this into an
 * `E_ANSWER_RANGE` rejection; it must never be swallowed or defaulted.
 */
export class AnswerNormalisationError extends Error {
  constructor(
    readonly rawCop: unknown,
    readonly copIndexBase: 0 | 1,
    message: string
  ) {
    super(message);
    this.name = 'AnswerNormalisationError';
  }
}

/**
 * Normalise a dataset `cop` to a 0-based {@link AnswerIndex}.
 *
 * `copIndexBase` is resolved empirically by the ETL (three independent methods
 * must agree) and is never inferred here — passing the wrong base is exactly the
 * H1 failure mode, so this function refuses anything that does not land in
 * {0,1,2,3} rather than clamping or defaulting.
 *
 * Fails closed (I4): throws, never guesses.
 */
export function toAnswerIndex(rawCop: unknown, copIndexBase: 0 | 1): AnswerIndex {
  const result = tryToAnswerIndex(rawCop, copIndexBase);
  if (!result.ok) throw new AnswerNormalisationError(rawCop, copIndexBase, result.reason);
  return result.value;
}

export type AnswerIndexResult =
  | { readonly ok: true; readonly value: AnswerIndex }
  | { readonly ok: false; readonly reason: string };

/**
 * Non-throwing form, for callers that must classify a failure rather than
 * propagate it — the ETL turns a failure here into an `E_ANSWER_RANGE`
 * rejection. Sharing one implementation with {@link toAnswerIndex} means the
 * throwing and non-throwing paths can never drift apart.
 */
export function tryToAnswerIndex(rawCop: unknown, copIndexBase: 0 | 1): AnswerIndexResult {
  if (typeof rawCop !== 'number' || !Number.isInteger(rawCop)) {
    return { ok: false, reason: `cop is not an integer: ${String(rawCop)}` };
  }
  const normalised = rawCop - copIndexBase;
  if (!isAnswerIndex(normalised)) {
    return {
      ok: false,
      reason: `cop ${rawCop} normalises to ${normalised} under base ${copIndexBase}, which is outside {0,1,2,3}`,
    };
  }
  return { ok: true, value: normalised };
}
