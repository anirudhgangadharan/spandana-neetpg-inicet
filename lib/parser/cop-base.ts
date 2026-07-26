/**
 * H1 — resolving the `cop` index base. Pure.
 *
 * This is the highest-severity hazard in the project: the official GitHub
 * release indexes answers from 1, the HuggingFace parquet export indexes from 0,
 * and the two are indistinguishable by inspection of a single record. Getting it
 * wrong makes every answer in the app wrong while everything still "works".
 *
 * The answer for the supplied archive is known (`copIndexBase = 1`, Appendix A),
 * but this code is not a formality. It is a REGRESSION GUARD: if a future
 * rebuild is fed the parquet export instead, the base silently flips and this is
 * the only thing standing between that and 187,000 wrong answers.
 *
 * Resolution never guesses. It aborts.
 */

/** Minimum semantic sample below which the cross-check cannot certify anything. */
export const MIN_SEMANTIC_SAMPLE = 200;
/** Required agreement ratio between the two interpretations (spec H1 step 3). */
export const MIN_SEMANTIC_RATIO = 3;

/**
 * Explanations frequently open with an answer marker. Real shapes in this corpus:
 *   "Ans. (c) Vitamin B12"      "Ans. is 'd' i.e., Roux en Y"   "Ans. C. Deficit…"
 *   "Ans) a (Abdominal aorta)"  "Ans : B (NAD+)"                "Answer is A, B, and C"
 *
 * The trailing `(?![a-z0-9])` guard stops "Ans. Adenosine deaminase" being read
 * as answer "A" — without it the false-positive rate swamps the signal.
 */
const ANS_MARKER = /\bans(?:wer)?\b[\s.:;)\-–—]*(?:is\b)?[\s.:;\-–—]*['"‘’“”(\[]*\s*([a-d])(?![a-z0-9])/i;

/** 0-based letter index (a→0 … d→3) asserted by the explanation, or null. */
export function parseAnswerMarker(explanation: unknown): number | null {
  if (typeof explanation !== 'string' || explanation.length === 0) return null;
  const m = ANS_MARKER.exec(explanation.slice(0, 200));
  if (m === null) return null;
  // The pattern has exactly one capturing group and it is not optional, so on a
  // successful match group 1 always participates.
  const letter = m[1] as string;
  return letter.toLowerCase().charCodeAt(0) - 97;
}

export interface CopObservations {
  readonly min: number;
  readonly max: number;
  readonly nulls: number;
  readonly histogram: ReadonlyMap<number, number>;
  /** Records where an answer marker was parsed out of the explanation. */
  readonly markerComparable: number;
  readonly markerAgree1: number;
  readonly markerAgree0: number;
}

export type CopResolution =
  | {
      readonly ok: true;
      readonly base: 0 | 1;
      readonly semanticConfirmed: boolean;
      readonly report: readonly string[];
    }
  | { readonly ok: false; readonly reason: string; readonly report: readonly string[] };

export function resolveCopIndexBase(obs: CopObservations): CopResolution {
  const report: string[] = [];
  const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(2)}%`);

  // --- Method 1: range ------------------------------------------------------
  report.push(`range: min=${obs.min} max=${obs.max} nulls=${obs.nulls}`);
  let rangeBase: 0 | 1 | null = null;
  if (obs.min === 1 && obs.max === 4) rangeBase = 1;
  else if (obs.min === 0 && obs.max === 3) rangeBase = 0;

  if (obs.min === 0 && obs.max === 4) {
    report.push('VERDICT: range [0,4] — the file is heterogeneous.');
    return { ok: false, reason: 'cop range is [0,4]: the source mixes 0-based and 1-based records', report };
  }
  if (rangeBase === null) {
    report.push(`VERDICT: range [${obs.min},${obs.max}] is neither [0,3] nor [1,4].`);
    return { ok: false, reason: `cop range [${obs.min},${obs.max}] matches no known encoding`, report };
  }
  if (obs.nulls > 0) {
    report.push(`VERDICT: ${obs.nulls} null cop values present.`);
    return { ok: false, reason: `${obs.nulls} records carry a null cop; ground truth is incomplete`, report };
  }
  report.push(`method 1 (range)  ⇒ ${rangeBase}-based`);

  // --- Method 2: semantic cross-check against explanation answer markers -----
  report.push(
    `marker sample n=${obs.markerComparable}: ` +
      `1-based ${obs.markerAgree1} (${pct(obs.markerAgree1, obs.markerComparable)}), ` +
      `0-based ${obs.markerAgree0} (${pct(obs.markerAgree0, obs.markerComparable)})`
  );

  if (obs.markerComparable < MIN_SEMANTIC_SAMPLE) {
    // Not an abort: the range check is definitive on its own (H1 step 2). But it
    // must be visible in the build log that only one method spoke.
    report.push(
      `method 2 (semantic) ⇒ INSUFFICIENT SAMPLE (<${MIN_SEMANTIC_SAMPLE}); resolved on range alone`
    );
    return { ok: true, base: rangeBase, semanticConfirmed: false, report };
  }

  const ratio1 = obs.markerAgree0 === 0 ? Number.POSITIVE_INFINITY : obs.markerAgree1 / obs.markerAgree0;
  const ratio0 = obs.markerAgree1 === 0 ? Number.POSITIVE_INFINITY : obs.markerAgree0 / obs.markerAgree1;

  let semanticBase: 0 | 1 | null = null;
  if (ratio1 >= MIN_SEMANTIC_RATIO) semanticBase = 1;
  else if (ratio0 >= MIN_SEMANTIC_RATIO) semanticBase = 0;

  if (semanticBase === null) {
    report.push('method 2 (semantic) ⇒ AMBIGUOUS — neither interpretation wins by 3:1');
    return {
      ok: false,
      reason: `semantic cross-check is ambiguous (${obs.markerAgree1} vs ${obs.markerAgree0}); refusing to guess`,
      report,
    };
  }
  report.push(
    `method 2 (semantic) ⇒ ${semanticBase}-based ` +
      `(${Number.isFinite(ratio1) ? ratio1.toFixed(1) : '∞'}:1)`
  );

  if (semanticBase !== rangeBase) {
    report.push('VERDICT: methods DISAGREE.');
    return {
      ok: false,
      reason: `range says ${rangeBase}-based but explanations say ${semanticBase}-based; refusing to guess`,
      report,
    };
  }

  report.push(`RESOLVED: copIndexBase = ${rangeBase}  (answerIndex = cop${rangeBase === 1 ? ' - 1' : ''})`);
  return { ok: true, base: rangeBase, semanticConfirmed: true, report };
}

/**
 * §5.3 assertion 4 — the off-by-one safety net.
 *
 * A genuine positional bias exists in this dataset (A ≈ 29%, D ≈ 21%, decreasing
 * monotonically), so the band must tolerate that. What it must NOT tolerate is
 * the signature of an off-by-one: one index near-empty and another near-half.
 */
export interface HistogramCheck {
  readonly ok: boolean;
  readonly shares: readonly [number, number, number, number];
  readonly message: string;
}

export function checkAnswerHistogram(
  counts: readonly [number, number, number, number],
  lowerBound = 0.1,
  upperBound = 0.4
): HistogramCheck {
  const total = counts[0] + counts[1] + counts[2] + counts[3];
  if (total === 0) {
    return { ok: false, shares: [0, 0, 0, 0], message: 'corpus is empty' };
  }
  const shares: [number, number, number, number] = [
    counts[0] / total,
    counts[1] / total,
    counts[2] / total,
    counts[3] / total,
  ];
  const offending = shares
    .map((s, i) => ({ i, s }))
    .filter((x) => x.s > upperBound || x.s < lowerBound);

  const rendered = shares.map((s, i) => `${'ABCD'[i]}=${(s * 100).toFixed(2)}%`).join('  ');
  if (offending.length > 0) {
    return {
      ok: false,
      shares,
      message:
        `answer-index distribution outside the ${lowerBound * 100}–${upperBound * 100}% band ` +
        `(${rendered}). This is the classic signature of an off-by-one in the cop index base.`,
    };
  }
  return { ok: true, shares, message: rendered };
}
