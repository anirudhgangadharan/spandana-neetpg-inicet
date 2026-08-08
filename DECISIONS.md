# Architecture decisions and objections to the specification

Format: each entry records the decision, the reasoning, and — where the decision
departs from the engineering specification — an explicit objection. Per §16 the
spec requires every deviation to be recorded here with rationale.

Status legend: **ACCEPTED** (follows spec) · **DEVIATION** (departs from spec) ·
**OBJECTION** (follows spec under protest) · **OPEN** (undecided).

---

## D-001 — Gate 0 reproduced; archive identity confirmed  · ACCEPTED

Ran `pnpm data:forensics` against the supplied `data.zip`. Every archive-identity
figure in Appendix A reproduced exactly: 182,822 / 4,183 / 6,150 records, zero
parse failures, 193,155 unique ids with zero duplicates, `cop` range [1,4] with
zero nulls, per-split `cop` histograms, `choice_type` splits, and `exp`/`topic_name`
null rates all matched to the digit. `test.json` carries 9 keys with `cop` and `exp`
absent, confirming H2.

`copIndexBase = 1` resolved by three independent methods that agree:

| Method | Result |
|---|---|
| Range check | min=1, max=4, 0 nulls → 1-based (definitive on its own: `cop=4` is out of range under a 0-based reading) |
| `"Ans. (x)"` marker parsed from `exp` (n=49,391) | 1-based 48,974 (99.16%) vs 0-based 25 (0.05%) — ratio 1959:1 |
| Correct-option text verbatim in `exp` (n=83,515) | 1-based 50,709 vs 0-based 11,921 |

**⇒ `answerIndex = cop - 1`.** Conversion happens exactly once, in the ETL.

Spot-confirmed by eye on printed samples: record `a74dcff7…` has `cop=1` and an
explanation opening `Ans. (A) Aztreonam`; record `3bb757c3…` has `cop=3` and an
explanation opening `(C) Catalepsy`. Both agree with the 1-based reading.

---

## D-002 — Appendix A's near-duplicate count is an artefact of near-exact matching · DEVIATION

Appendix A.8 reports 45 redundant near-duplicates and concludes "H6 is a
near-non-issue here". Reproducing that number required checking, because it
disagreed sharply with my first measurement. Both were computed and reported:

| Hashing method | Redundant records (answerable splits) |
|---|---|
| Exact string, options in positional order | **0** |
| Normalised (lowercase, markup stripped, non-alphanumerics collapsed), option-set sorted | **18,252** |

The exact method finds *nothing*, which is why Appendix A's figure is so low. The
normalised method finds genuine restatements. Inspected samples:

- `"Pearsonian measure of skewness -"` vs `"Pearsonian measure of skewness-"` — and one copy writes options as `Mean - Mode/ SD`, the other as `Mean - Mode\/SD`.
- `"…recurrent meningitis due to CSF leaks?"` vs the same stem ending `:`.
- `"Glucose sympo occurs with:"` vs `"Glucose sympo occurs with"` with options **B and C transposed** (both `cop=1`, both pointing at `Na+` — consistent).

These are real duplicates by the standard that matters: a student would see the
same item twice in one exam session. **Decision: use the normalised, option-set-sorted
hash for H6.** Appendix A's figure is retained in the report for comparison but is
not used.

Note this changes no rejection count. Per H6 duplicates are *retained and tagged*
`duplicateOf`, excluded only from randomised session generation. They do not count
toward the I4 2% rejection threshold. Measured rejection rate is **0.103%**
(67 single-distinct-option + 126 short-stem records over 187,005).

---

## D-003 — Forensics answer-marker regex required calibration · ACCEPTED

The first `"Ans. (x)"` matcher demanded a closing delimiter after the letter and
so matched only 12 records — far below the 200-record floor the spec sets for the
semantic cross-check, which correctly refused to certify and failed the gate. The
dominant real shape is `Ans. is 'a' i.e., …`, where the letter is preceded by an
apostrophe rather than followed by a bracket. The corrected matcher tolerates
`Ans. (c)`, `Ans. is 'd'`, `Ans. C.`, `Ans) a`, `Ans : B`, and `Answer is A`, and
uses a trailing `(?![a-z0-9])` guard so `Ans. Adenosine…` is not misread as answer A.

The residual 417 non-agreeing matches (0.84%) were inspected and are almost
entirely **multi-answer explanations** — e.g. `Ans. is 'a' … 'b' … 'c'` paired with
`cop=4` where option D reads "All of the above". That is H3's labelling
inconsistency showing through, not an index-base problem.

---

## D-004 — NEW HAZARD (H9): duplicate groups with conflicting answers · DEVIATION (addition)

Not recorded in the spec or Appendix A, and it matters more than H6 does.

Of the 18,252 normalised-duplicate records, **1,104 duplicate groups carry
conflicting `cop` values** — the same question stem with the same option set,
labelled with *different* correct answers by different source records.

At least one member of every such group is wrong. This is the only defect found
that can present a student with a confidently-displayed incorrect answer while
every validation rule passes.

**Policy — H9:**
1. Detect conflicting-answer groups in the ETL and flag **every** member with
   `conflicting_answer_variant`, not just the non-canonical ones. The canonical
   record is not known to be the correct one; it is merely first.
2. **Do not attempt to resolve the conflict.** Picking a winner by majority vote,
   by explanation text, or by any other heuristic would be exactly the runtime
   answer-derivation that I1 and I2 forbid. Fail visible, not silent.
3. Exclude all members from randomised session generation (they are already
   excluded as duplicates, except the canonical one — exclude that too).
4. Surface a visible warning chip on affected cards: this item has a conflicting
   duplicate elsewhere in the dataset and one of them is wrong.
5. Report the count in the validation report.

This deliberately shows the student a defect rather than hiding it, consistent
with the reasoning in H4 that visible corruption is safer than silent repair.

---

## D-005 — Storage engine: SQLite over sharded static JSON · ACCEPTED (§3.1 requires a choice)

**Decision: `better-sqlite3` reading a build-time `corpus.sqlite`.**

Reasoning:

- The corpus is ~187k rows. FTS5 gives ranked full-text search over stems,
  options and explanations with no client-side index to ship and no per-shard
  fetch amplification. The sharded-JSON fallback would need a hand-built inverted
  index to meet the p95 < 150 ms search budget in §11, which is re-implementing
  FTS5 badly.
- Facet counts (subject × topic × flags) are a `GROUP BY`. Under sharded JSON
  they must be precomputed for every filter combination or computed client-side
  over data the client is not allowed to hold (§13 anti-requirement 8).
- Filter composition (subject ∧ topic ∧ attempted ∧ flagged) is a `WHERE` clause.
  Under sharded JSON, filters that cut across the shard key require fetching
  every shard — which is shipping the corpus to the client by another name.
- `better-sqlite3` is synchronous and in-process; there is no network hop, so the
  query layer's cost is dominated by SQLite itself (sub-millisecond for indexed
  point lookups).

Cost accepted: this requires a Node server runtime. The app cannot be deployed to
a purely static host. Given §11's search-latency and §13's no-corpus-on-client
constraints, that trade is already implied by the spec.

Per §3.1's instruction, the sharded-JSON path is **not** built.

---

## D-006 — H8 handled by stripping markup in the ETL, not by runtime sanitising · DEVIATION

The spec permits either a strict allowlist or stripping entirely, and forbids
`dangerouslySetInnerHTML` on dataset text unless routed through a tested sanitiser.

Measured: only 866 records of 193,155 contain markup, and it is near-uniformly
junk — `<p>…<\p>` wrappers (note the malformed closing tag) and `&;`-mangled
entities from a broken export, not meaningful formatting. There is nothing of
value to preserve.

**Decision: strip all markup and decode entities in the ETL. Store plain text.
Render through normal React interpolation, which escapes by default.**

Consequence: `dangerouslySetInnerHTML` appears nowhere in the codebase at all, so
anti-requirement 6 is satisfied structurally rather than by a sanitiser that must
be trusted. The sanitiser is still written as a pure, unit-tested function with
script-injection tests (§12), and a CI grep forbids `dangerouslySetInnerHTML`
outright.

---

## D-007 — Difficulty omitted entirely · ACCEPTED

§4 offers (a) omit or (b) derive empirically from ≥30 community attempts, and
directs choosing (a) for v1. Taking (a). No difficulty field exists anywhere in
the type contract, the database schema, or the UI. Option (b) is unavailable in
any case: §8 puts accounts and sync out of scope, so there is no mechanism by
which aggregate cross-user accuracy could exist.

---

## D-008 — `Unknown` subject is a real bucket, not a null · ACCEPTED

Per A.5, `"Unknown"` is a literal `subject_name` value on 3,047 records. It is
carried through as an ordinary subject. Records with a null `topic_name` (52.3% of
train, 89.9% of dev) are bucketed as `Uncategorised` at query time and are never
dropped from filter results, per H5.

---

## D-009 — Objection: §12.1 T1's cost/benefit · OBJECTION

T1 requires iterating the entire corpus and asserting `isCorrect(q, i) === (i === q.answerIndex)`
for all four indices — ~750k assertions on every CI run.

Objection: `isCorrect` is a single `===` on a value read straight from the row.
Iterating the corpus tests SQLite's ability to return a column, not the correctness
of the function; the function's behaviour is fully covered by the property test in
T4 over arbitrary inputs. The genuine risk T1 gestures at — a systematically
shifted answer key — is caught by the §5.3 post-normalisation assertions and by
the `answerKeyHash` check in T6, both of which are cheaper and more direct.

Complying anyway, because the spec is explicit and the cost is tolerable (the test
runs in seconds against a local SQLite file). Recorded so the objection is on file.

---

## D-004a — H9 empirically confirmed by the T2 oracle · (evidence for D-004)

T2 compares the built corpus against an oracle derived from the answer letter
stated in each record's *explanation prose* — a signal that never passes through
`cop`, so it is independent of the index-base decision under test.

Of 1,000 oracle rows, **999 agree exactly**. The single disagreement is
`6d8023fe-7a66-445c-9c74-8f012d3a027e`:

> *"In a patient of unilateral loss of vision … the injury is said to be"*
> Options: A Simple · B Grievous · C Dangerous · D Hazardous
> `cop = 1` → the corpus says **Simple**.
> The explanation says *"Ans. is 'b' i.e., Grievous"*.

The explanation is right: permanent loss of sight of either eye is grievous hurt.
The record's `cop` is wrong, and **the corpus already flags it**
`conflicting_answer_variant` — a duplicate elsewhere carries the correct answer.
H9 caught the only wrong answer the independent oracle could find.

Consequently T2 asserts something stronger than a tolerance: **every oracle
disagreement must be a record the corpus already flags as suspect.** An unflagged
disagreement fails the build. That turns "we have some bad rows" into "we know
which rows are bad, and we tell the user".

---

## D-011 — Two-distinct-option records are flagged as well as three · DEVIATION

H7 says: "Reject records with fewer than 2 distinct non-empty options; flag (do
not reject) records with 3 distinct options." That leaves records with **exactly
2** distinct options accepted and unflagged, which appears to be an oversight —
a 4-option question presenting only 2 distinct answers is worse than one
presenting 3, not better.

Added a `two_distinct_options` flag alongside `three_distinct_options`. No record
is rejected that the spec would have accepted; the change only adds a warning.
Measured: 39 records rejected for having a single distinct option, and a small
number flagged for two.

---

## D-012 — CI grep for `answerIndex` carves out `tests/` · DEVIATION

§16 requires that "`answerIndex` appears in no file outside `lib/core/` and
`types/` (CI-enforced grep)". §12.1 T1 simultaneously requires asserting
`isCorrect(q, i) === (i === q.answerIndex)` over the whole corpus. Both cannot
hold literally.

Resolution: `tests/` is exempt; nothing in the shipped application is. The check
also matches only genuine *reads* of the field — property access (`.answerIndex`)
and destructuring (`{ answerIndex }`) — rather than every textual occurrence, so
build-log prose such as `answerIndex = cop - 1` does not fail CI while
`q.answerIndex` in a component does. Verified by a negative test: a probe file
containing each violation shape was confirmed to fail the check before being
deleted.

`lib/core` exposes `correctOptionPosition(q)` as the sanctioned read path for UI
code that must mark the correct row after submission (§9.3).

---

## D-013 — Bug found and fixed in option-field detection · (process note)

The first implementation of §5.1's "option fields are a set of 4 short string
fields with high mutual sibling correlation" measured similarity as
`|len(a) − len(b)| / (len(a) + 1)` — **asymmetric**. A long field therefore
counted every short field as its sibling without the reverse holding, and
outscored the real options.

On the real corpus this never fired, because explanations average ~700 characters
and were excluded by the length cap. It fired immediately on a test fixture with
a short explanation, which selected `exp` as an option field and shifted every
option index by one. Had the corpus ever shipped with slightly shorter
explanations, this would have produced silently wrong answers.

Replaced with two signals, strongest first:

1. **Enumeration shape** — four fields sharing a prefix and distinguished by a
   one-character `a/b/c/d` or `1/2/3/4` suffix. This is a signal about the naming
   *pattern*, not about specific names, so it satisfies §5.1's requirement that
   name priors "must not be the sole basis" while identifying `opa..opd`,
   `option_a..option_d` and `c1..c4` equally well.
2. **Symmetric length correlation** as a fallback, which additionally reports
   in the confidence reasons that the weaker signal was used.

The regression is now covered by a test asserting that a short `exp` is not
mistaken for an option.

---

## D-014 — Rejection-rate denominator excludes the test split · DEVIATION

I4 fails the build if "the rejection rate exceeds 2% of records". The test split
is 6,150 of 193,155 records (3.18%) and is excluded wholesale under H2 — so a
literal reading of I4 would fail every build on a hazard the spec itself instructs
us to handle by exclusion.

Appendix A.9's own projection subtracts the test split *before* computing a
projected rejection rate of "well under 0.1%", so this reading is the intended
one. The build reports the two figures separately:

- **Validation rejections:** 214 of 187,005 answerable records = **0.1144%** (the I4 gate).
- **Policy exclusions (H2):** 6,150 records, reported with the reason "ground truth withheld upstream".

Rejection breakdown: `E_MISSING_STEM` 127, `E_OPTION_EMPTY` 48,
`E_OPTION_DISTINCT` 39. Note `E_OPTION_EMPTY` fires 48 times where the Phase 0
forensics found zero empty options: validation sanitises *before* measuring, so an
option consisting only of markup is correctly empty.

---

## D-015 — The test split is excluded entirely, not exposed in a browse mode · ACCEPTED

H2 offers two options: exclude the test split from practice entirely, or expose it
in a labelled browse mode with answering disabled. Taking the first. The §4 type
contract defines `Split` as `'train' | 'validation'`, so a browse mode would
require widening the core type to admit records that have no answer — putting
answerless records inside the same type the correctness core operates on. The
value of browsing 6,150 unanswerable questions does not justify that.

Asserted by test: `SELECT DISTINCT split FROM questions` returns exactly
`['train', 'validation']`.

---

## D-016 — Corpus database is 254 MB; that is accepted · ACCEPTED

`corpus.sqlite` is larger than the 147 MB source JSON:

| Component | Size |
|---|---|
| `questions` table (the text itself) | 155 MB |
| FTS5 index | 66 MB |
| B-tree indexes | 30 MB |

This never reaches the client (§13 anti-requirement 8) — it is read server-side
by `better-sqlite3`. The FTS index uses `content='questions'` external-content
mode, so the indexed text is not duplicated; 66 MB is the inverted index itself.
Reducing it would mean `detail=none`, which disables phrase queries, or dropping
explanations from the index, which removes the most useful search target. Neither
trade is worth 60 MB of server-side disk.

Consequence worth noting for D-010: this file sits inside a OneDrive-synced
folder. It is git-ignored but will still sync.

---

## D-017 — The corruption heuristic assumed corruption is rare; it is not · DEVIATION (bug fixed)

The first `buildCorruptionLexicon` required the corrupted form to be **rarer**
than the intact form, on the reasoning that a corruption should be the minority
spelling. Measured over the corpus, that is false:

| corrupted | count | intact | count |
|---|---|---|---|
| `aery` | **11,511** | `artery` | 7,151 |
| `impoant` | **4,572** | `important` | 3,797 |
| `hypeension` | **4,131** | `hypertension` | 2,557 |
| `paial` | **1,495** | `partial` | 1,204 |
| `cailage` | **1,387** | `cartilage` | 1,256 |

For the words it affects, the defect is the **majority** spelling — exactly what
Appendix A.7 says ("H4 confirmed, widespread"). The rule silently suppressed the
ten most frequent corruptions in the dataset. The lexicon looked clean (66
precise pairs) while missing most of what it existed to find.

Frequency ordering carries no signal here and is no longer consulted. The
lexicon now holds **345 pairs**, and the top entries are precisely Appendix A.7's
list. Guarding precision instead is `AMBIGUOUS_ALLOWLIST`, curated by reading
the whole generated list (`reports/lexicon-review.txt`): of 345 pairs only four
are ordinary words rather than artefacts — `main` (from "martin", 3,362
occurrences, which would have chipped a large number of clean cards), `stale`
(from "startle"), `sieve` (from "sievert"), and `robe` (from "robert").

`aerial` and `aeries` are deliberately **not** allowlisted despite being real
words: in an AIIMS/NEET-PG stem they are overwhelmingly mangled "arterial" and
"arteries", and Appendix A.7 counts `aerial` as a corruption. Both decisions are
one line to reverse, which is the point of an explicit list rather than a
threshold.

The lesson generalises: the guard was calibrated against an assumption about the
data instead of against the data. The regression test now asserts the real
frequency inversion directly.

---

## D-018 — Public deployment: rate limiting, headers, and the 255 MB corpus · ACCEPTED

The app is to be publicly linkable with no authentication, which is a deliberate
product choice, not an oversight. Three consequences were handled:

1. **Abuse.** With no auth, `/api/search` (FTS5 over 187k documents) is the
   cheapest way to make the instance expensive for everyone else. `middleware.ts`
   applies a fixed-window per-IP limit: 240 req/min general, 60 req/min on
   search. Verified: exactly 60 allowed per window, then 429 with `Retry-After`.
   It is **in-memory and therefore per-instance** — scaling past one machine
   turns it into a per-machine limit and it should move to a shared store.

2. **Hosting.** The 255 MB corpus rules out every Git-based and serverless host:
   GitHub rejects files over 100 MB (both `train.json` at 141 MB and
   `corpus.sqlite` at 255 MB exceed it), and serverless bundles cap far below
   255 MB with a read-only filesystem. The corpus is therefore **baked into a
   Docker image** and deployed from the local directory via Fly.io or Railway.
   Baking rather than mounting is deliberate: the answer key is fixed at build
   time (I1) and checksum-verified at startup (§3.2), so the image and the corpus
   it serves should be one indivisible artefact. A volume lets the two drift
   apart, which is the exact failure the checksum exists to catch.

3. **CSP.** `connect-src 'self'` is a browser-enforced second line behind
   invariant I2: even a compromised dependency cannot reach an external inference
   endpoint from the page. `script-src` gets no `unsafe-inline` in production.

Not done, and stated plainly in HOSTING.md rather than glossed: axe-core,
Lighthouse on a throttled profile, and the Playwright suite are Phase 4 and have
not been run.

---

## D-019 — Attribution is a launch requirement, not decoration · ACCEPTED

§2.4 requires an in-app credits panel citing the paper and linking the
repository. Before publishing this was only partially satisfied — the footer
named the paper but linked nothing. Apache-2.0 permits redistribution *with
attribution*, so on a public deployment this is a licence obligation.

The footer now cites Pal et al. in full and links the paper, the dataset
repository, and the licence, alongside the standing "not clinical guidance"
notice and a statement that nothing is generated or auto-corrected. It must stay
visible.

---

## D-020 — CSP `script-src 'self'` produced a blank production page · DEVIATION (bug fixed)

The first public deployment served a completely blank page while every
server-side signal reported healthy: `/api/health` returned `ready: true` with a
verified checksum over 186,791 rows, and the HTML response was 166 KB and
contained the disclaimer text.

Cause: `script-src 'self'`. React 19 streams server-rendered content to the
browser inside inline `<script>self.__next_f.push(...)</script>` blocks. Blocking
inline scripts does not degrade the page gracefully — it produces an empty one,
because the shell paints and the content never arrives.

The failure mode is worth recording because of how it hid: the HTML was correct,
the server was correct, and a `curl`-based check *passed*. Matching on response
text confirmed the string was in the payload but not that a browser would ever
execute the script that revealed it. Only loading the page in a real browser and
counting rendered elements caught it. Server-side assertions cannot verify client
rendering.

`script-src` now allows `'unsafe-inline'`. The cost is low here: all dataset text
is reduced to plain text during the ETL and rendered through React
interpolation, `dangerouslySetInnerHTML` is banned and CI-enforced (§13.6), and
the app renders no user-supplied or remote markup — so there is no injection
vector for an inline script to exploit. The clause carrying real weight,
`connect-src 'self'`, is untouched and remains a browser-enforced second line
behind invariant I2.

Proper fix, deliberately not attempted as a hotfix: per-request nonces issued
from middleware, which would allow `'unsafe-inline'` to be dropped.

---

## D-021 — USMLE (MedQA-USMLE, US 4-option subset) added as a second question source · ACCEPTED

Scope agreed with the user before implementation (full plan at
`.claude/plans/structured-mapping-balloon.md`): **US English only**, and
specifically the pre-filtered 4-option files
(`US/4_options/phrases_no_exclude_{train,dev,test}.jsonl`) — not the top-level
`US/train.jsonl` etc., which are natively 5-option and out of scope, and not
the Mainland-China or Taiwan editions (Chinese-language, and in Taiwan's case
a near-useless category field), which don't serve this app's English
NEET-PG/INICET audience.

Measured, not assumed: sampled 300 records from the chosen files and confirmed
100% carry exactly 4 options before committing to the 4-option-only scope —
this is what let every option-count assumption already baked into the trusted
core (`AnswerIndex = 0|1|2|3`, `Question.options` as a 4-tuple) and the
option-rendering UI (`OptionGroup.tsx`) stay completely untouched. Widening
those to a variable option count was considered and explicitly rejected for
this pass: it would touch the correctness-critical, 100%-branch-covered,
CI-grepped trusted core for a data source this app doesn't strictly need to
support in its native 5-option form.

Build result on the real data: all **12,723** records (10,178 train / 1,272
dev / 1,273 test) accepted, **zero** rejected, **zero** near-duplicates within
the source (`DuplicateIndex` stats: 12,723 groups, 0 redundant — a curated
exam bank has none of MedMCQA's messier-provenance duplication). MedMCQA's own
numbers were verified byte-identical before and after this work: 186,791
accepted, same 214-record rejection breakdown, same 1,104 H9 conflict groups,
same 18,240 H6 duplicates, same `copIndexBase = 1` resolution. The combined
corpus is 199,514 rows (186,791 + 12,723, arithmetic checked directly against
the manifest, not assumed).

License note: no `LICENSE`/`README`/citation file accompanied the local
download. See D-028.

---

## D-022 — `Split` stays exactly `'train' | 'validation'`; USMLE's `test` folds into `validation` · ACCEPTED

USMLE's `test.jsonl` genuinely carries visible `answer_idx` values (confirmed
by reading it directly) — unlike MedMCQA's `test.json`, which the authors
withhold entirely (H2) and which is why `Split` was deliberately narrowed to
two values in the first place (D-015). USMLE's test split is not withheld
ground truth; it's just another slice of answerable exam questions.

This app has no notion of "held out for model evaluation" — it is a practice
tool for people, not a training pipeline. To a student, MedMCQA's `dev` and
USMLE's `dev`/`test` are all simply "more questions with visible answers."
Rather than add a third `Split` value (which would ripple into
`lib/core/question.ts`'s `SPLITS` constant, the API's `VALID_SPLITS`,
`FacetsFile.splits`, and an existing integration-test assertion that the
global split vocabulary is exactly two-valued), USMLE's three files fold onto
the existing semantic: `train → 'train'`, `dev`/`test → 'validation'`.

Cost accepted: USMLE's dev/test distinction (a real distinction in the
original ML benchmark) is not recoverable from the `split` column alone once
folded — only from the per-source manifest breakdown, which still records
each raw file's count separately. Verified in
`tests/integration/corpus.test.ts`: USMLE rows exist in both `train` and
`validation`, and `validation` count for `source='usmle'` equals exactly
1,272 + 1,273.

---

## D-023 — USMLE's `meta_info` becomes two literal `subject` values, not a new facet dimension · ACCEPTED

`meta_info` has exactly two values across the whole US set: `"step1"` and
`"step2&3"` — exam stage, not a clinical subject the way MedMCQA's
Anatomy/Medicine/Surgery are. Mapped to `subject = 'USMLE Step 1'` /
`subject = 'USMLE Step 2 & 3'` (an unrecognised third value would fail open to
a generic `'USMLE'` bucket, never reject the record — same "Unknown" pattern
as D-008). This reuses 100% of the existing subject/topic filter plumbing
(`SessionSetup.tsx` checkboxes, `topicsBySubject`, `QuestionFilters.subjects`)
for free, and the bucket names self-disclose what they are rather than
pretending to be a peer of MedMCQA's clinical taxonomy.

The mapping itself lives in `lib/constants/sources.ts`, not
`lib/parser/usmle.ts`, specifically so it's importable from client ('use
client') UI code — `lib/parser/usmle.ts` pulls in `node:crypto` for id
synthesis (D-026) and must never end up in a browser bundle.

`topic` is always `null` for USMLE (→ "Uncategorised", an already-designed
empty state). `choiceType` is always `'single'` — the schema carries no
`choice_type`-equivalent field at all.

Alternative considered and rejected: a dedicated `exam_stage` column/facet.
More "correct" modelling for two values isn't worth the added schema and UI
surface; revisit if USMLE ever grows a third piece of metadata.

---

## D-024 — Standalone parser module, not an extension of `schema.ts`/`validate.ts`/`cop-base.ts` · ACCEPTED

`lib/parser/usmle.ts` is a new, independent file, for two structural reasons:

1. **Shape.** USMLE's options live in a single nested object keyed `"A".."D"`
   (`{question, options: {A,B,C,D}, answer, answer_idx, meta_info}`), not four
   sibling top-level fields the way MedMCQA's `opa/opb/opc/opd` are.
   `lib/parser/schema.ts`'s structural detector inspects top-level object keys
   only (presence rate, length correlation, enumeration-suffix patterns) and
   genuinely cannot see into a nested object without a flattening shim. Writing
   a dedicated ~240-line adapter was cleaner than bolting a shim onto machinery
   built for a different shape.
2. **Dedup/corruption scoping.** H6/H9 duplicate and conflicting-answer
   detection run as **two structurally separate `DuplicateIndex` instances**
   in `scripts/etl/build.ts` (one per source), not one shared-but-namespaced
   index — makes it impossible by construction, not merely unlikely, for a
   MedMCQA question and an unrelated USMLE question to be flagged as
   duplicates of each other. Verified directly:
   `tests/integration/corpus.test.ts`'s "dedup/conflict detection never
   crosses a source boundary" test joins every `duplicate_of` pointer against
   its target's `source` column and asserts zero cross-source matches.
   MedMCQA's H4 corruption lexicon (the `rt`-token-loss detector) is similarly
   never run against USMLE text — that defect is specific to MedMCQA's own
   provenance pipeline, and Pass A's token-counting loop is guarded to
   `src.source === 'medmcqa'` accordingly.

Source discovery itself changed to match: `data/raw/<source>/` is now an
explicit, closed per-source directory map (`scripts/etl/read.ts`'s
`SOURCE_DIRS`), not a flat glob keyed by filename. The prior design
(`splitFor(name)` mapping `train`/`dev`/`test` globally by basename) would have
silently merged a second source's same-named files into the first source's
splits — confirmed as a real, not hypothetical, risk: the chosen USMLE files
happen to be named `phrases_no_exclude_train.jsonl` etc. rather than
`train.jsonl`, but the fix does not depend on that filename luck. A third
source sharing MedMCQA's or USMLE's file-naming convention today would still
land in its own bucket, untouched by either.

---

## D-025 — USMLE answer resolution is a standalone letter lookup, not an extension of H1 · ACCEPTED

`answer_idx` is a single letter (`A`-`D`), unambiguous by construction.
MedMCQA's `cop`-index-base ambiguity (H1) — resolved by three independent
empirical methods that must agree, because the two published MedMCQA
distributions disagree about 0- vs 1-based indexing — simply has no equivalent
here. `resolveUsmleLetter` in `lib/parser/usmle.ts` is a direct table lookup
(`A→0, B→1, C→2, D→3`, case/whitespace-tolerant, fails closed on anything
else including the fifth option letter `E` that exists in the 5-option files
this ETL deliberately doesn't ingest). It shares its result shape
(`AnswerIndexResult`) with `lib/core/answer-index.ts`'s `tryToAnswerIndex` for
consistency, but calls into none of `cop-base.ts`'s cross-check machinery —
building a parallel 3-method empirical resolution here would be solving a
problem this source doesn't have.

Consequence in the UI: `QuestionCard.tsx`'s "Report this question" payload
(I5) now branches on `question.source` — MedMCQA reports its `cop`-encoded,
`copIndexBase`-adjusted answer as before; USMLE reports its native letter.
This was a real, if quiet, bug caught before shipping: the payload
unconditionally computed a `copIndexBase`-adjusted number and labelled it
`"${copIndexBase}-based (cop)"` for every question, which would have reported
a fabricated fact about a field a USMLE record doesn't have.

---

## D-026 — Deterministic USMLE id synthesis: `usmle-` + a 24-hex-char content hash · ACCEPTED

USMLE's source data has no id field at all. `synthesizeUsmleId` in
`lib/parser/usmle.ts` hashes (sha256, truncated to 24 hex chars) the raw split
token (`train`/`dev`/`test` — the label *before* the D-022 fold into `Split`,
so the id stays stable even if the fold policy changes later) plus the
sanitised stem, all four options, and the resolved answer letter, each field
separated by a control character (`String.fromCharCode(1)`, never a literal
escape in source — see the implementation note in `usmle.ts` about why) so
field-boundary ambiguity (`stem="ab"+opt="c"` hashing the same as
`stem="a"+opt="bc"`) can't happen.

Same input always reproduces the same id, so a rebuild from the same source
files is stable and reproducible. The `usmle-` prefix makes collision with
MedMCQA's UUID-format ids (`a74dcff7-74d2-...`) structurally impossible — a
different id *alphabet* entirely, not merely different by convention. A
byte-for-byte repeat of the same content (same stem, options, and answer)
collides on this hash and is rejected as `E_DUPLICATE_ID` before H6's
near-duplicate pass ever runs, which is a reasonable secondary property of the
scheme rather than its purpose.

`seenIds` is shared across both sources within a given ETL pass (defense in
depth — the id-alphabet split already makes cross-source collision impossible,
so sharing the set costs nothing and catches any future surprise for free
rather than silently allowing it).

---

## D-027 — I4's rejection-rate gate and the §5.3 histogram assertion are evaluated per source · DEVIATION (addition)

At roughly 6% of the blended corpus (12,723 of 199,514), a USMLE-specific
ingestion bug could clear a blended *global* 2% rejection-rate gate while
quietly failing within USMLE alone — the small source hides inside the
average. `scripts/etl/build.ts` now gates I4 **independently per source**
(both `medmcqa` and `usmle` must each individually clear 2%; the blended
figure is still computed and logged for continuity, just no longer the sole
gate).

The §5.3 assertion-4 histogram-band check (10–40% per answer index) is
specifically a regression guard for H1's off-by-one failure mode — it exists
to catch a MedMCQA cop-index-base resolution gone wrong. USMLE has no such
failure mode: its answer is a validated letter with no encoding ambiguity to
get wrong in the first place. Running MedMCQA's hard-fail gate against USMLE's
histogram would be testing for a bug class that source cannot exhibit, so
USMLE's histogram is computed and logged for visibility only, never gated.
Measured on the real build: USMLE's distribution is markedly more balanced
than MedMCQA's (A=25.68% B=25.77% C=25.58% D=22.97%, vs MedMCQA's known
positional bias A=29.36%…D=21.28%, A.4) — consistent with a curated exam bank
versus MedMCQA's messier aggregation, and would have passed the hard gate
anyway had it been applied, but that's not something a regression guard should
rely on.

The manifest's `sources.medmcqa`/`sources.usmle` breakdown (new
`SourceManifestEntry` type) is what makes the per-source figures inspectable
after the fact, not just visible in the build log.

---

## D-028 — USMLE licensing: cited, not asserted · ACCEPTED

No `LICENSE`, `README`, or citation file accompanied the local MedQA-USMLE
download. Unlike MedMCQA's licence situation (D-005's era — two named licences
to reconcile, Apache-2.0 vs a CC0 mirror), there is nothing local to reconcile
*from* here at all. Per the user's explicit decision (asked directly before
this work began): build and deploy, citing the dataset honestly, without
asserting a specific redistribution licence for it.

`ATTRIBUTION.md` gained a full second `## Dataset` section (citation, bibtex,
repository link) mirroring MedMCQA's section's structure and tone, but its
licence subsection states plainly that no licence file was found and none is
asserted, rather than picking one by inference the way D-005-era MedMCQA
licensing did. The in-app disclaimer (`components/Disclaimer.tsx`) and its
persistent footer gained a matching citation. Redistribution risk for the
USMLE-derived portion of the corpus is the deploying party's to verify — this
matches the user's explicit instruction and is stated as such in both places.

---

## D-029 — Bug found in browser verification: mixed-source sessions silently returned 100% MedMCQA · DEVIATION (bug fixed)

Caught during the manual browser smoke test the USMLE integration plan
required before publishing (not by any automated test — this is exactly why
that step was mandatory rather than optional). Selecting both MedMCQA and
USMLE as the question bank and starting a session produced a "mixed" session
whose 20 questions were, every time, 100% MedMCQA.

Cause: `planSession`'s candidate pool (`lib/db/queries.ts`) was built with a
single `SELECT id FROM questions WHERE source IN (...) ORDER BY rowid LIMIT
poolSize` query. `rowid` is SQLite's insertion order, which is the ETL's
processing order (`scripts/etl/build.ts` processes `corpusSources` in
discovery order — every MedMCQA file before any USMLE file). The two sources
therefore occupy disjoint, non-interleaved rowid ranges: MedMCQA's ~186,791
accepted rows all have lower rowids than USMLE's 12,723. A pool of any
practical size (`poolSize` tops out around 20,000 even for a 500-question exam)
never reached far enough into rowid space to include a single USMLE row,
*regardless* of pool size or question count — this was not a probabilistic
bias that occasionally under-represented USMLE, it was a deterministic,
100%-of-the-time exclusion.

Fix: when more than one source is selected, `planSession` pools each source
independently (`listQuestionIds` called once per source with `sources: [x]`,
each up to the full `basePoolSize`) and concatenates before the existing
seeded shuffle (`sampleWithoutReplacement`) runs. Single-source sessions are
untouched — same query, same behaviour, verified via a dedicated regression
test. Multi-source sessions now draw from a pool that actually contains both.

Verified three ways: (1) a new integration test,
`tests/integration/session-plan.test.ts`, asserts a mixed 100-question plan
contains at least one question from each selected source across five
different seeds — this test would have deterministically failed under the
prior code, for every seed, not flakily; (2) the live dev server, both before
the fix (confirmed 100/0 via `/api/questions` grouped by `source`) and after
(confirmed a 55/45 split for the same request shape); (3) `pnpm verify` full
suite green afterward (237 tests).

The bug was specific to having two sources with very different volumes and
strictly sequential insertion order — a single-source deployment, or two
similarly-sized interleaved sources, would not have exhibited it, which is
part of why it wasn't anticipated in the original design (D-005's pooling
rationale predates any notion of a second source).

---

## D-010 — Repository lives inside a OneDrive-synced, non-ASCII path · OPEN

Working directory is `C:\Users\ganga\OneDrive\문서\NEET MCQ`. Two environmental
risks, neither spec-related, both worth recording:

1. `data/raw/` (141 MB) and `node_modules/` are inside a synced folder. They are
   git-ignored but OneDrive will still upload them. Recommend marking both
   "Free up space" / excluding them from sync.
2. The path contains non-ASCII characters (`문서`). This occasionally breaks
   native-module builds on Windows. Mitigated by preferring prebuilt binaries.

Flagged for the user; not acted on unilaterally since the working directory was
specified.
