# MedMCQA Practice

Practice AIIMS/NEET-PG style questions from
[MedMCQA](https://github.com/medmcqa/medmcqa) and USMLE-style questions from
[MedQA-USMLE](https://github.com/jind11/MedQA) — 199,514 questions total
(186,791 MedMCQA across 21 subjects + 12,723 USMLE, US English 4-option
subset). Pick a question bank in the sidebar; MedMCQA is the default.

> **Not clinical guidance.** This is exam-preparation material from a public
> research dataset that contains known errata. Never use it for patient care
> decisions.

## What makes this different

Every answer starts from the imported dataset. Authorized faculty can now
record an audited correction to a question or answer key; the latest correction
is served for future practice and tests while the imported corpus remains
unchanged. There is no generative component in the correctness path — no model
call, inference, or "best guess". Faculty corrections are attributable edits,
not independent clinical validation.

Because the dataset has real defects, they are **labelled rather than hidden**:

- **1,104 questions** appear twice with *different* answers marked correct. At
  least one of each pair is wrong, so every member of the group is flagged
  "Disputed answer" and excluded from randomised sessions. The app does not try
  to adjudicate — picking a winner by majority vote would be exactly the runtime
  answer-derivation the design forbids.
- **Thousands of questions** have the letters `rt` dropped from words — "artery"
  printed as "aery", "hypertension" as "hypeension". These are flagged and shown
  **as-is**. Auto-correcting mangled medical text is more dangerous than showing
  it broken: a silently "fixed" drug name is the worst failure this product could
  produce.
- **About one question in eight** has no explanation. That empty state is
  designed, not apologised for.
- The **USMLE question bank has no explanation field at all** — it shows the
  same honest empty state on every card, for that reason, not because
  anything is missing.

## Correctness

The served answer for a question is a single integer from the verified corpus
or its latest audited faculty correction, and the only
computation that decides a verdict is index equality:

```ts
verdict = (selection === answerIndex) ? CORRECT : INCORRECT
```

No string comparison, no normalisation, no similarity, no fallback. That
property is enforced rather than trusted:

- MedMCQA's answer encoding is resolved **empirically** at build time by three
  independent methods that must agree, because the two published distributions
  of MedMCQA disagree about whether answers are 0- or 1-indexed. Getting it
  wrong would make every answer wrong while everything still appeared to work.
  USMLE's answer field has no such ambiguity — it's a direct letter lookup,
  validated the same way every other field is (fail closed, never guessed).
- The imported corpus — both question banks — is checksummed at build time and
  re-verified at startup. If the answer key does not match, the app refuses to
  serve any questions at all.
- A CI grep enforces that the answer field is unreadable outside the trusted
  core, so no UI code can improvise its own notion of correctness.
- 300+ tests, including an exhaustive pass asserting the answer mapping over
  every question and every option in the built corpus, and a round-trip test
  against an oracle derived independently of the encoding under test.

Full reasoning, including every deviation from the specification and the bugs
found along the way, is in [`DECISIONS.md`](DECISIONS.md).

## Faculty tests

Faculty can publish a timed test link. Students enter name, registration number,
and roll number without Google sign-in. These are self-reported identifiers,
not proof of identity. Choices remain in that browser until the student submits
or the timer triggers submission; the server then stores and scores the complete
answer sheet once. A browser or network failure before submission can lose
answers. A faculty member can issue a 15-minute one-time recovery code after
verifying the student through an independent channel. Faculty can also erase a
guest participant's identity and attempts. The in-app privacy notice explains
retention and deletion.

Corrections made while building a draft become the served version for future
practice and modules. Every version records its author, reason, timestamp, and
source-corpus hash; prior versions can be restored. Existing published tests
and scores retain their frozen question and answer snapshot. A future corpus
rebuild needs an explicit correction rebase review before serving resumes.

## Running it locally

```bash
pnpm install
```

Put MedMCQA's `train.json`/`dev.json`/`test.json` in `data/raw/medmcqa/`, and
(optionally) USMLE's 4-option `train.jsonl`/`dev.jsonl`/`test.jsonl` in
`data/raw/usmle/` — a source with no files there simply contributes nothing to
the build. Then build the corpus:

```bash
pnpm data:build
```

```bash
pnpm dev
```

Copy `.env.example` to `.env.local` and fill the account/database values before using authenticated practice or faculty features. Migration commands are dry-run by default; see [`SCHEMA_MIGRATIONS.md`](SCHEMA_MIGRATIONS.md).

## Faculty assessments

The authenticated application has three isolated roles:

- students practise normally and take shared-link timed modules;
- each faculty account drafts, publishes, archives, and analyzes only its own modules;
- the creator may enable a separate read-only analytics link, allowing anyone with it to view that module's analytics and identifiable student results without sign-in; links can be replaced or disabled (see [`ANALYTICS_SHARING.md`](ANALYTICS_SHARING.md));
- the super admin manages up to three faculty email grants but has no question, response, or detailed-analytics bypass.

Published modules freeze question content, order, marking, attempt policy, and review policy in Postgres. Shared links accept guest students after they enter a name, registration number, and roll number; Google sign-in is not required for those tests. Answers remain in browser session storage until one final submission, while the server enforces deadlines and attempt limits. Faculty can correct a question in a draft; audited overrides become the effective question pool for future practice and modules while the source corpus and existing published snapshots remain unchanged. Faculty selection defaults to globally unused questions while revealing no other professor's module identity.

Self-service account deletion is at `/account/delete`, with public instructions at `/delete-account` and the public notice at `/privacy`. See [`PRIVACY.md`](PRIVACY.md) for exact cascade behavior and unresolved operator-retention requirements.

## Verification and release status

Common local checks are:

```bash
pnpm typecheck
pnpm lint
pnpm lint:invariants
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
pnpm data:modules:rehearse
```

The precise Milestone 5 evidence is in [`FACULTY_MODULES_MILESTONE_5.md`](FACULTY_MODULES_MILESTONE_5.md). This repository is a web application, not an Android application. It has no AAB or Android project and is not Google Play-ready; see [`GOOGLE_PLAY_RELEASE.md`](GOOGLE_PLAY_RELEASE.md) and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

Deployment configuration, secrets, readiness, migration order, scheduled expiry, and scaling limitations are documented in [`HOSTING.md`](HOSTING.md).

## Attribution

Questions from **MedMCQA**:

> Ankit Pal, Logesh Kumar Umapathi, Malaikannan Sankarasubbu. *MedMCQA: A
> Large-scale Multi-Subject Multi-Choice Dataset for Medical domain Question
> Answering.* PMLR v174, 2022.

[Paper](https://proceedings.mlr.press/v174/pal22a.html) ·
[Dataset](https://github.com/medmcqa/medmcqa) ·
[Licence](LICENSE-DATASET.txt) (Apache-2.0)

Questions from **MedQA-USMLE** (US English, 4-option subset):

> Di Jin, Eileen Pan, Nassim Oufattole, Wei-Hung Weng, Hanyi Fang, Peter
> Szolovits. *What Disease does this Patient Have? A Large-scale Open Domain
> Question Answering Dataset from Medical Exams.* arXiv:2009.13081, 2020.

[Paper](https://arxiv.org/abs/2009.13081) ·
[Dataset](https://github.com/jind11/MedQA) ·
[Licence](LICENSE-MEDQA.txt) (MIT; verified from the upstream code-and-data repository)

Full attribution and the list of transformations applied during import:
[`ATTRIBUTION.md`](ATTRIBUTION.md).
