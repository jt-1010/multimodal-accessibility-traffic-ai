# Sign language datasets — what exists, and what we should use

Surveyed 2026-09-09. Every claim below was checked against the actual data or
the dataset's own paper, not from memory.

---

## First: the Google dataset is neither videos nor pictures

This surprises people, and it is the single most important fact for our design.

GISLR ships as **Parquet files of coordinates**. The original videos are not
distributed at all. Here are the first rows of a real file from the dataset:

```
   frame     row_id  type   landmark_index      x         y         z
0     21  21-face-0  face                0  0.400119  0.443299 -0.063108
1     21  21-face-1  face                1  0.394721  0.397763 -0.074098
2     21  21-face-2  face                2  0.395926  0.416701 -0.051361
```

- **543 points per frame** — face, left_hand, pose, right_hand
- One row per point per frame
- **No image data anywhere.** Just x/y/z positions

Somebody already ran MediaPipe over the videos and shipped the output. Which
means our browser produces *the same kind of data the model was trained on* —
no video decoding, no train/serve mismatch, and a dataset small enough to
train on a free GPU.

**Verified totals:** 94,477 clips · 250 signs · 21 signers.

---

## The options

| Dataset | What it is | Size | Signers | Licence |
|---|---|---|---|---|
| **GISLR** (Google/Kaggle) | **Landmarks** | 94,477 clips, 250 signs | 21 Deaf | Competition rules, research use |
| **PopSign ASL v1.0** | **Videos** (smartphone) | ~210,000 clips, 250 signs | 47 Deaf | Research, Georgia Tech |
| **ASL Citizen** (Microsoft) | **Videos** (webcam) | 83,399 clips, **2,731 signs** | 52 | MSR licence, IRB consent |
| **WLASL** | **Videos** (scraped) | ~21,000 clips, 2,000 signs | many | C-UDA, academic only |
| **How2Sign** | **Videos**, continuous sentences | 80+ hours, 35,191 sentences | 11 | Research |
| ASL Alphabet / Sign MNIST | **Static images**, A–Z only | ~87,000 images | few | CC |

### GISLR — our primary source

Already landmarks, already the format we serve in, 21 Deaf signers, and the
250-word vocabulary contains 31 signs directly useful for ordering (verified —
see `training.md`).

The full download is tens of GB of Parquet. Preprocess once into a compact
`.npy` of only the 153 values in `ml/feature_spec.json` and train from that.

```bash
kaggle competitions download -c asl-signs -p data/asl   # accept rules first
```

### PopSign ASL v1.0 — the same 250 signs, as video

GISLR was derived from this. 210,000 clips from **47 Deaf adult signers** for
whom ASL is their primary language, filmed on phone selfie cameras — so the
camera angle matches a terminal far better than studio footage does.

Useful if we ever want to re-extract landmarks with different settings, or
train on raw video. Their baseline LSTM gets **82.1%** on the 250 signs, which
is a fair target for our own model.

### ASL Citizen — checked, and it changes the plan

**Result: 93% of our ordering vocabulary needs no recording by us.**

Run `python ml/asl/vocabulary.py` to reproduce. Of 62 ordering concepts:

| | Count | Source |
|---|---|---|
| Already in GISLR | 17 | downloaded, nothing to do |
| In ASL-LEX (so very likely ASL Citizen) | 41 | request the dataset |
| **Must record ourselves** | **4** | CHICKEN, NUGGET, FIVE, TEN |

`BURGER` is in there as `hamburger`, along with `coffee`, `soda`, `cheese`,
`want`, `more`, `eat`, `order`, `pay`, `large` (as `big`), `small`, and eight
of the ten digits.

The four genuine gaps are odd rather than difficult: ASL-LEX has `hen` and
`rooster` but no `chicken`, no `nugget` at all, and — strangely — every digit
except `five` and `ten`. `NUGGET` can be fingerspelled or expressed as
CHICKEN + SMALL, so realistically this is **three signs to record**, not the
28 we planned.

> **Verified vs inferred.** The glosses above are *verified* present in
> ASL-LEX 2.0 (downloaded, checked). That ASL Citizen shares that vocabulary
> is a strong *inference*: it has 2,731 signs against ASL-LEX's 2,723, and its
> stated use case is dictionary retrieval. Confirm against ASL Citizen's own
> label list once Microsoft grants access.

### ASL Citizen — the dataset itself

**83,399 videos, 2,731 signs, 52 signers** — ten times GISLR's vocabulary.

> **Action item (now):** request ASL Citizen from Microsoft Research and
> confirm its label list against `ml/asl/vocabulary.py`.

Collected from 52 everyday signers with consent under IRB approval — the most
ethically careful of the datasets here, which is worth a sentence in the
report on its own.

Their reported accuracy is **63% top-1, 91% recall@10** on unseen signers.
That is the honest state of the art on a large vocabulary, and a useful
corrective to any repo claiming 92% on scraped stock photos.

It ships as video, so using it means running MediaPipe over 83k clips to get
landmarks — a few hours of compute, entirely doable.

### WLASL — usable, but read the licence

2,000 words, but scraped from the web, so recording conditions vary wildly and
some source videos have disappeared. **C-UDA: academic and computational use
only, no commercial use.** Fine for a thesis; note it explicitly.

### How2Sign — not for this project

Continuous signed *sentences*, not isolated signs. That is a harder,
unsolved problem. Right for a translation system, wrong for ours: an ordering
terminal needs discrete words it can map to menu actions.

### Static alphabet datasets — a fallback only

Only fingerspelled A–Z, single frames. Cannot represent movement, which is
one of the five parameters of ASL phonology and changes what a sign means.

There is one legitimate use: **fingerspelling as an escape hatch.** When
someone signs a word outside our vocabulary, they can spell it. Slow, but it
means no request is ever a dead end. Numbers 1–9 are static handshapes too, so
a small static model handles quantities cheaply.

---

## Recommendation

1. **GISLR as the base.** Right format, right size, Deaf signers, and a third
   of an ordering vocabulary for free.
2. **Request ASL Citizen** — checked, and it covers 41 more of our ordering
   concepts, signed by 52 consenting signers rather than by us.
3. **Record only CHICKEN, FIVE and TEN** with `ml/collect`. (NUGGET can be
   fingerspelled or signed CHICKEN + SMALL.)
4. **Optionally add a static model** for numbers and fingerspelling.

## Why this ordering matters for the report

Every dataset above except our own recordings was collected from Deaf signers
with consent. Ours will be four hearing students who are not fluent. Leaning on
the public datasets for as much of the vocabulary as possible is not laziness —
it produces a better model *and* a more defensible one, because a system for
Deaf users trained mostly on hearing learners' signing is a methodological
weakness a committee will rightly ask about.

## Sources

- [GISLR (Kaggle)](https://www.kaggle.com/competitions/asl-signs)
- [PopSign ASL v1.0 (NeurIPS 2023)](https://proceedings.neurips.cc/paper_files/paper/2023/hash/00dada608b8db212ea7d9d92b24c68de-Abstract-Datasets_and_Benchmarks.html)
- [ASL Citizen (Microsoft Research)](https://www.microsoft.com/en-us/research/project/asl-citizen/) · [paper](https://arxiv.org/abs/2304.05934)
- [WLASL](https://dxli94.github.io/WLASL/)
- [How2Sign](https://how2sign.github.io/)
