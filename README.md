---
title: MedMCQA Practice
emoji: 🩺
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 3000
pinned: false
license: apache-2.0
short_description: AIIMS / NEET-PG practice over the MedMCQA dataset
---

# MedMCQA Practice

Practice AIIMS and NEET-PG style questions over the
[MedMCQA](https://github.com/medmcqa/medmcqa) research dataset — 186,791
questions across 21 subjects.

> **Not clinical guidance.** This is exam-preparation material from a public
> research dataset that contains known errata. Never use it for patient care
> decisions.

## What makes this different

Every answer comes from the dataset and nothing else. There is no generative
component anywhere in the correctness path — no model call, no inference, no
"best guess". Where the dataset is silent, the app is silent.

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

## Correctness

The answer for a question is a single integer fixed at build time, and the only
computation that decides a verdict is index equality:

```ts
verdict = (selection === answerIndex) ? CORRECT : INCORRECT
```

No string comparison, no normalisation, no similarity, no fallback. That
property is enforced rather than trusted:

- The dataset's answer encoding is resolved **empirically** at build time by
  three independent methods that must agree, because the two published
  distributions of MedMCQA disagree about whether answers are 0- or 1-indexed.
  Getting it wrong would make every answer wrong while everything still appeared
  to work.
- The whole corpus is checksummed at build time and re-verified at startup. If
  the answer key does not match, the app refuses to serve any questions at all.
- A CI grep enforces that the answer field is unreadable outside the trusted
  core, so no UI code can improvise its own notion of correctness.
- 193 tests, including an exhaustive pass asserting the answer mapping over
  every question and every option, and a round-trip test against an oracle
  derived independently of the encoding under test.

Full reasoning, including every deviation from the specification and the bugs
found along the way, is in [`DECISIONS.md`](DECISIONS.md).

## Running it locally

```bash
pnpm install
```

Put the MedMCQA JSON files in `data/raw/`, then build the corpus:

```bash
pnpm data:build
```

```bash
pnpm dev
```

## Attribution

Questions from **MedMCQA**:

> Ankit Pal, Logesh Kumar Umapathi, Malaikannan Sankarasubbu. *MedMCQA: A
> Large-scale Multi-Subject Multi-Choice Dataset for Medical domain Question
> Answering.* PMLR v174, 2022.

[Paper](https://proceedings.mlr.press/v174/pal22a.html) ·
[Dataset](https://github.com/medmcqa/medmcqa) ·
[Licence](LICENSE-DATASET.txt) (Apache-2.0)

Full attribution and the list of transformations applied during import:
[`ATTRIBUTION.md`](ATTRIBUTION.md).
