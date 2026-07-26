/**
 * H4 — detection of the `rt` token-loss defect. Pure.
 *
 * Appendix A.7 directs building "an `rt`-reinsertion dictionary check against a
 * medical lexicon rather than a hardcoded list". No medical lexicon ships with
 * this project, so the lexicon is DERIVED FROM THE CORPUS ITSELF, which is both
 * self-contained and better targeted than any general word list would be:
 *
 *   1. Count every lowercase alphabetic token in the corpus.
 *   2. For each frequent token containing "rt" (e.g. "artery", "hypertension"),
 *      compute its corrupted form by deleting the bigram ("aery", "hypeension").
 *   3. Keep the pair only if the corrupted form ALSO occurs in the corpus with
 *      meaningful frequency — both forms coexisting is the artefact's signature.
 *   4. Reject candidates that are legitimate words, via {@link AMBIGUOUS_ALLOWLIST}.
 *
 * ⚠ A NOTE ON A HEURISTIC THAT WAS WRONG (DECISIONS.md D-017)
 *
 * An earlier version of step 3 also required the corrupted form to be RARER than
 * the intact form, reasoning that a corruption should be the minority spelling.
 * In this corpus that is false, and measurably so:
 *
 *     aery      11,511   vs   artery         7,151
 *     hypeension 4,131   vs   hypertension   2,557
 *     impoant    4,572   vs   important      3,797
 *
 * The defect is the MAJORITY spelling for the words it affects, exactly as
 * Appendix A.7 says ("H4 confirmed, widespread"). The rule silently suppressed
 * the ten most frequent corruptions in the dataset — the detector looked precise
 * while missing most of what it existed to find. Frequency ordering carries no
 * signal here and is no longer consulted.
 *
 * The generated lexicon is written to `data/build/corruption-lexicon.json` for
 * human review, because an auto-derived dictionary that nobody reads is not a
 * dictionary check, it is a guess.
 *
 * Policy is FLAG, NEVER REPAIR (§13 anti-requirement 5). A false positive costs
 * a spurious warning chip; an auto-"correction" of a mangled drug name is the
 * worst failure this product can produce.
 */

/** Minimum occurrences of the intact form before it is trusted as a real word. */
export const DEFAULT_MIN_INTACT_FREQ = 20;
/** Minimum occurrences of the corrupted form before it is trusted as systematic. */
export const DEFAULT_MIN_CORRUPT_FREQ = 3;
/** Shorter corrupted forms collide with ordinary words far too often. */
export const DEFAULT_MIN_CORRUPT_LENGTH = 4;

/**
 * Corrupted forms that are also perfectly ordinary words. Deleting "rt" from a
 * real word sometimes yields another real word, and those must not be flagged.
 *
 * "aerial" is the interesting case: it is the corruption of "arterial" AND a
 * common English word. It is retained as a detection (Appendix A.7 lists it)
 * because in this corpus's medical register "aerial" is overwhelmingly the
 * corrupted form — but it is listed here so the choice is visible and reversible
 * rather than buried in a threshold.
 */
export const AMBIGUOUS_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Reviewed against the full 349-pair derived lexicon (see
  // `pnpm tsx scripts/etl/review-lexicon.ts` and reports/lexicon-review.txt).
  // These four are the only entries that are ordinary words in their own right
  // rather than corruption artefacts. Everything else in the lexicon —
  // "aoic", "veebral", "hypeension", "cailage" and so on — is unambiguous.
  'main', // ← from "martin". 3,362 occurrences; flagging these would put a
  //             warning chip on a large number of entirely clean cards.
  'stale', // ← from "startle". Both are ordinary words; "stale air/blood" is real.
  'sieve', // ← from "sievert". "Sieve" is itself common medical vocabulary.
  'robe', // ← from "robert".
  //
  // Deliberately NOT allowlisted, though both are real English words:
  //   "aerial"  ← from "arterial" (2,096 vs 1,346). Appendix A.7 counts this as a
  //               corruption in this corpus, and in a medical stem "aerial" is far
  //               more likely to be a mangled "arterial" than to mean airborne.
  //   "aeries"  ← from "arteries". The word exists (eagles' nests) but will not
  //               occur in an AIIMS/NEET-PG question.
  // Both decisions are reversible by adding them here, which is the point of
  // keeping this list explicit rather than burying the judgement in a threshold.
]);

export interface LexiconEntry {
  readonly corrupted: string;
  readonly intact: string;
  readonly corruptedFreq: number;
  readonly intactFreq: number;
}

export interface BuildLexiconOptions {
  readonly minIntactFreq?: number;
  readonly minCorruptFreq?: number;
  readonly minCorruptLength?: number;
  /** Overrides {@link AMBIGUOUS_ALLOWLIST}. Injectable so a reviewed allowlist
   *  can be supplied from the build config rather than edited into this file. */
  readonly allowlist?: ReadonlySet<string>;
}

/** Every distinct string obtainable by deleting one occurrence of "rt". */
export function corruptedForms(token: string): string[] {
  const out = new Set<string>();
  let from = 0;
  for (;;) {
    const i = token.indexOf('rt', from);
    if (i === -1) break;
    out.add(token.slice(0, i) + token.slice(i + 2));
    from = i + 1;
  }
  return [...out];
}

/**
 * Derive the corruption lexicon from corpus token frequencies.
 * Deterministic: the same counts always produce the same lexicon, sorted.
 */
export function buildCorruptionLexicon(
  tokenCounts: ReadonlyMap<string, number>,
  options: BuildLexiconOptions = {}
): LexiconEntry[] {
  const minIntact = options.minIntactFreq ?? DEFAULT_MIN_INTACT_FREQ;
  const minCorrupt = options.minCorruptFreq ?? DEFAULT_MIN_CORRUPT_FREQ;
  const minLen = options.minCorruptLength ?? DEFAULT_MIN_CORRUPT_LENGTH;
  const allowlist = options.allowlist ?? AMBIGUOUS_ALLOWLIST;

  /** corrupted form -> best (most frequent) intact source */
  const best = new Map<string, LexiconEntry>();

  for (const [intact, intactFreq] of tokenCounts) {
    if (intactFreq < minIntact || !intact.includes('rt')) continue;
    for (const corrupted of corruptedForms(intact)) {
      if (corrupted.length < minLen) continue;
      if (allowlist.has(corrupted)) continue;
      const corruptedFreq = tokenCounts.get(corrupted) ?? 0;
      if (corruptedFreq < minCorrupt) continue;

      const prev = best.get(corrupted);
      if (prev === undefined || intactFreq > prev.intactFreq) {
        best.set(corrupted, { corrupted, intact, corruptedFreq, intactFreq });
      }
    }
  }

  return [...best.values()].sort(
    (a, b) => b.corruptedFreq - a.corruptedFreq || a.corrupted.localeCompare(b.corrupted)
  );
}

const TOKEN_RE = /[a-z]+/g;

/** Lowercase alphabetic tokens. Shared by lexicon building and detection so the
 *  two can never disagree about what a token is. */
export function tokenise(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

export function countTokensInto(counts: Map<string, number>, text: string): void {
  for (const t of tokenise(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
}

/** The corrupted tokens present in `text`, deduplicated, in first-seen order. */
export function detectCorruption(text: string, lexicon: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const t of tokenise(text)) {
    if (lexicon.has(t) && !seen.has(t)) {
      seen.add(t);
      found.push(t);
    }
  }
  return found;
}
