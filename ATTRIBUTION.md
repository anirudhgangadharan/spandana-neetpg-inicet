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

The dataset is not redistributed by this repository. `data/raw/` is git-ignored,
and the build artefacts under `data/build/` are generated locally. The ETL applies
these transformations, all of them recorded in `data/build/validation-report.json`:

- `cop` is normalised from its 1-based encoding to a 0-based answer index
  (resolved empirically — see DECISIONS.md D-001).
- The **test split is excluded**: its ground truth is withheld upstream.
- Markup is stripped from text fields and HTML entities are decoded.
- Records failing validation are excluded and counted by reason (0.1144%).
- Records are **flagged, never altered**, for suspected text corruption,
  conflicting duplicate answers, sparse metadata, and inconsistent
  `choice_type` labelling.

No question text, option text, or explanation text is rewritten, corrected, or
generated. The known `rt` token-loss corruption in the source is displayed as-is
with a warning, deliberately, because silently "correcting" medical text is more
dangerous than showing it broken.

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

This is exam-preparation material drawn from a public research dataset. It is not
clinical guidance, it contains known errata, and it must not be used for patient
care decisions. See the in-app disclaimer.
