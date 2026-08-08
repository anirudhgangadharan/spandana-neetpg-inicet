/**
 * The type contract (spec §4). Defined once; everything else derives from it.
 *
 * ⚠ This file and `lib/core/` are the ONLY places permitted to name `answerIndex`.
 * Enforced by `scripts/ci/check-invariants.mjs`.
 */

/** 0-based, always. The ONLY representation of an answer in the system. */
export type AnswerIndex = 0 | 1 | 2 | 3;

/**
 * The four splits collapse to two in the corpus: MedMCQA's `dev` is renamed
 * `validation` per §2.2, and `test` never enters the corpus at all (H2 — the
 * authors withhold its ground truth).
 */
export type Split = 'train' | 'validation';

export type ChoiceType = 'single' | 'multi';

/**
 * Which question bank a record originates from. Independent of `subject`
 * (clinical domain, e.g. "Anatomy") and `split` (train/validation): `source` is
 * the corpus dimension a session filters on before subject/topic apply at all.
 *
 * Deliberately a closed union, not `string` — adding a third source is a
 * reviewed code change (new discovery directory, new split/answer-resolution
 * path), never data silently picked up by a directory scan.
 */
export type QuestionSource = 'medmcqa' | 'usmle';

export type QuestionFlag =
  /** H4 — an `rt`-token-loss artefact was detected in the stem or options. */
  | 'possible_text_corruption'
  /** H7 — exactly 3 distinct option strings. */
  | 'three_distinct_options'
  /** H7 (extension, D-011) — exactly 2 distinct option strings. */
  | 'two_distinct_options'
  /** H5 — `exp` was null or empty upstream. */
  | 'no_explanation'
  /** H5 — `topic_name` was null upstream. */
  | 'no_topic'
  /** H3 — upstream `choice_type` is "multi" but the record carries one answer. */
  | 'multi_choice_type'
  /** H8 — markup fragments were stripped from this record's text during ETL. */
  | 'markup_stripped'
  /**
   * H9 (D-004) — this question has a normalised duplicate elsewhere in the
   * corpus whose `cop` disagrees. At least one of them is wrong. Flagged on
   * EVERY member of the group, canonical included: being first is not evidence
   * of being right.
   */
  | 'conflicting_answer_variant';

export interface Question {
  readonly id: string;
  readonly source: QuestionSource;
  readonly split: Split;
  readonly stem: string;
  readonly options: readonly [string, string, string, string];
  readonly answerIndex: AnswerIndex;
  readonly explanation: string | null;
  readonly subject: string;
  readonly topic: string | null;
  readonly choiceType: ChoiceType;
  readonly flags: readonly QuestionFlag[];
  /** Canonical record's id if this is a normalised duplicate of another (H6). */
  readonly duplicateOf: string | null;
  /**
   * False when this record must not appear in a randomised session: it is a
   * duplicate (H6) or a member of a conflicting-answer group (H9). Such records
   * remain reachable by direct id and by browse/search — they are excluded, not
   * hidden.
   */
  readonly sessionEligible: boolean;
}

export type Verdict = 'correct' | 'incorrect' | 'unattempted' | 'skipped';

/**
 * Persisted per question. Note: contains NO answer data (I3). A user who edits
 * their IndexedDB can corrupt their own progress but cannot change what the app
 * considers correct.
 */
export interface AttemptRecord {
  readonly questionId: string;
  readonly selectedIndex: AnswerIndex | null;
  readonly verdict: Verdict;
  /** epoch ms */
  readonly attemptedAt: number;
  readonly durationMs: number;
  readonly bookmarked: boolean;
}

// ---------------------------------------------------------------------------
// Build-time artefacts
// ---------------------------------------------------------------------------

/** Typed reason codes from §5.2. First failure rejects the record. */
export type RejectionCode =
  | 'E_MISSING_ID'
  | 'E_DUPLICATE_ID'
  | 'E_MISSING_STEM'
  | 'E_OPTION_COUNT'
  | 'E_OPTION_EMPTY'
  | 'E_OPTION_DISTINCT'
  | 'E_ANSWER_MISSING'
  | 'E_ANSWER_RANGE'
  | 'E_ANSWER_UNRESOLVED';

export interface Rejection {
  readonly code: RejectionCode;
  readonly split: string;
  readonly line: number;
  readonly id: string | null;
  readonly detail: string;
}

export interface BuildManifestCounts {
  readonly raw: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly duplicates: number;
  readonly conflictingAnswerGroups: number;
  readonly sessionEligible: number;
}

/**
 * Per-source breakdown. `copIndexBase`/`copDiagnostics` are `null` for any
 * source without MedMCQA's H1 cop-index-base ambiguity (D-025) — USMLE's
 * answer field is an unambiguous letter, so there is nothing to diagnose.
 */
export interface SourceManifestEntry {
  readonly counts: BuildManifestCounts;
  readonly answerIndexHistogram: readonly [number, number, number, number];
  readonly copIndexBase: (0 | 1) | null;
  readonly copDiagnostics: BuildManifest['copDiagnostics'] | null;
}

export interface BuildManifest {
  readonly builtAt: string;
  readonly appVersion: string;
  /** Resolved empirically in the ETL, never guessed (H1). MedMCQA-specific — see `sources`. */
  readonly copIndexBase: 0 | 1;
  readonly copDiagnostics: {
    readonly rangeMin: number;
    readonly rangeMax: number;
    readonly markerComparable: number;
    readonly markerAgree1: number;
    readonly markerAgree0: number;
  };
  readonly sourceFiles: readonly { readonly file: string; readonly bytes: number; readonly sha256: string }[];
  /** Global totals across every source. */
  readonly counts: BuildManifestCounts;
  readonly answerIndexHistogram: readonly [number, number, number, number];
  /** sha256 over sorted `id:index` pairs, over every row regardless of source.
   *  Recomputed at startup and compared (§3.2). */
  readonly answerKeyHash: string;
  readonly sources: Readonly<Record<QuestionSource, SourceManifestEntry>>;
}

export interface FacetsFile {
  readonly subjects: readonly { readonly name: string; readonly count: number }[];
  readonly topicsBySubject: Readonly<Record<string, readonly { readonly name: string; readonly count: number }[]>>;
  readonly flags: readonly { readonly name: QuestionFlag; readonly count: number }[];
  readonly splits: readonly { readonly name: Split; readonly count: number }[];
  readonly sources: readonly { readonly name: QuestionSource; readonly count: number }[];
  readonly total: number;
}
