# Attribution and licence

## Dataset

This application is built over the **MedMCQA** dataset.

> Ankit Pal, Logesh Kumar Umapathi, Malaikannan Sankarasubbu.
> **MedMCQA: A Large-scale Multi-Subject Multi-Choice Dataset for Medical domain
> Question Answering.**
> *Proceedings of the Conference on Health, Inference, and Learning*,
> PMLR volume 174, pages 248–260, 2022.

- Repository: https://github.com/medmcqa/medmcqa
- HuggingFace: https://huggingface.co/datasets/openlifescienceai/medmcqa
- Proceedings: https://proceedings.mlr.press/v174/pal22a.html

```bibtex
@InProceedings{pmlr-v174-pal22a,
  title     = {MedMCQA: A Large-scale Multi-Subject Multi-Choice Dataset for Medical domain Question Answering},
  author    = {Pal, Ankit and Umapathi, Logesh Kumar and Sankarasubbu, Malaikannan},
  booktitle = {Proceedings of the Conference on Health, Inference, and Learning},
  pages     = {248--260},
  year      = {2022},
  editor    = {Flores, Gerardo and Chen, George H and Pollard, Tom and Ho, Joyce C and Naumann, Tristan},
  volume    = {174},
  series    = {Proceedings of Machine Learning Research},
  month     = {07--08 Apr},
  publisher = {PMLR}
}
```

### Licence discrepancy — noted, not resolved

The HuggingFace distribution states **Apache-2.0**. A Kaggle mirror of the same
data lists **CC0-1.0**. These are different licences and we cannot reconcile them
from the outside, so this project treats the dataset as **Apache-2.0**, the more
restrictive of the two and the one published alongside the authors' own
repository. The Apache-2.0 text is reproduced in [`LICENSE-DATASET.txt`](LICENSE-DATASET.txt).

Anyone redistributing this application together with the dataset should verify the
licence position independently rather than relying on this note.

### What was changed

The dataset is not redistributed by this repository. `data/raw/medmcqa/` is
git-ignored, and the build artefacts under `data/build/` are generated locally.
The ETL applies these transformations, all of them recorded in
`data/build/validation-report.json`:

- `cop` is normalised from its 1-based encoding to a 0-based answer index
  (resolved empirically — see DECISIONS.md D-001).
- The **test split is excluded**: its ground truth is withheld upstream.
- Markup is stripped from text fields and HTML entities are decoded.
- Records failing validation are excluded and counted by reason (0.1144% of
  this dataset's own answerable records — see DECISIONS.md D-027 for why
  each dataset's rejection rate is tracked and gated independently).
- Records are **flagged, never altered**, for suspected text corruption,
  conflicting duplicate answers, sparse metadata, and inconsistent
  `choice_type` labelling.

No question text, option text, or explanation text is rewritten, corrected, or
generated. The known `rt` token-loss corruption in the source is displayed as-is
with a warning, deliberately, because silently "correcting" medical text is more
dangerous than showing it broken.

## Dataset (second question bank)

This application also draws questions from **MedQA-USMLE** — specifically the
US English, 4-option subset (`US/4_options/`), 12,723 records.

> Di Jin, Eileen Pan, Nassim Oufattole, Wei-Hung Weng, Hanyi Fang, Peter Szolovits.
> **What Disease does this Patient Have? A Large-scale Open Domain Question
> Answering Dataset from Medical Exams.**
> *arXiv:2009.13081*, 2020.

- Repository: https://github.com/jind11/MedQA
- Paper: https://arxiv.org/abs/2009.13081

```bibtex
@article{jin2020disease,
  title   = {What Disease does this Patient Have? A Large-scale Open Domain Question Answering Dataset from Medical Exams},
  author  = {Jin, Di and Pan, Eileen and Oufattole, Nassim and Weng, Wei-Hung and Fang, Hanyi and Szolovits, Peter},
  journal = {arXiv preprint arXiv:2009.13081},
  year    = {2020}
}
```

### Licence — not resolved, not asserted

No `LICENSE`, `README`, or citation file accompanied the copy of this dataset
used to build this corpus. Unlike the MedMCQA discrepancy above (two named
licences to reconcile), here there is nothing local to reconcile from at all.
This project therefore does **not** assert a specific redistribution licence for
the USMLE-derived data — it cites the dataset and its origin honestly and stops
there. Anyone redistributing this application together with the USMLE-derived
data should verify licensing terms independently before relying on this note.

### What was changed

`data/raw/usmle/` is git-ignored, matching MedMCQA's handling. The ETL applies:

- `answer_idx` (a letter, `A`–`D`) is resolved to a 0-based answer index by
  direct lookup — unambiguous by construction, with no equivalent to MedMCQA's
  `cop`-index-base hazard to resolve (DECISIONS.md D-025).
- Records have **no native id** in the source data; a deterministic id is
  synthesised from the record's own content, prefixed `usmle-` so it can never
  collide with MedMCQA's UUID-format ids (DECISIONS.md D-026).
- `meta_info` (exam stage: `step1` / `step2&3`) is mapped to a literal
  `subject` value, distinct from MedMCQA's clinical subjects and clearly
  labelled as such (DECISIONS.md D-023).
- This dataset carries **no explanation field at all** — every USMLE question
  shows the same honest empty state for that reason.
- Of 12,723 records, **0 were rejected** by validation.

No question or option text is rewritten. MedMCQA's `rt` token-loss corruption
detector (H4) is not applied to this dataset — that defect is specific to
MedMCQA's own provenance pipeline (DECISIONS.md D-021/D-024).

## Software

This application's own source is separate from the dataset licence. Third-party
runtime dependencies:

| Package | Licence |
|---|---|
| next, react, react-dom | MIT |
| better-sqlite3 | MIT |
| zustand | MIT |
| idb | ISC |
| @tanstack/react-virtual | MIT |

SQLite itself is in the public domain.

## Not medical advice

This is exam-preparation material drawn from public research datasets. It is not
clinical guidance, it contains known errata, and it must not be used for patient
care decisions. See the in-app disclaimer.
