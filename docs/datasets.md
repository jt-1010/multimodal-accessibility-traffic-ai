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

### ASL Citizen — downloaded and verified

46 GB, byte-complete, valid zip: **83,400 videos, 2,731 signs, 52 signers**.
Its split CSVs carry `Participant ID, Video file, Gloss, ASL-LEX Code` — the
last column confirming the vocabulary is ASL-LEX derived.

Clips per sign: min 21, median 31, max 45.

**Verified against the real gloss list — 93% of our ordering vocabulary needs
no recording by us.** Reproduce with `python ml/asl/vocabulary.py`:

| | Count | Source |
|---|---|---|
| Already in GISLR | 17 | downloaded |
| In ASL Citizen | 41 | downloaded |
| **Must record ourselves** | **4** | CHICKEN, NUGGET, FIVE, TEN |

`BURGER` is present as `hamburger`, plus `coffee`, `soda`, `cheese`, `want`,
`eat`, `order`, `pay`, `big`, `small`, `restaurant` and eight of ten digits.

Several signs have multiple variants and therefore more data than the median:
`sandwich1..4` gives 122 clips, `want1/want2` 61, `eat1/eat2` 63.

> **A naming trap worth knowing.** ASL-LEX writes variants as `shake_1`;
> ASL Citizen writes `shake1`. Matching only the underscore form reported
> twelve missing signs when the true number was four. `VARIANT_SUFFIX` in
> `ml/asl/vocabulary.py` handles both.

**Licence: Microsoft Research Licence Terms — non-commercial research use
only.** Fine for a thesis; state it explicitly, and do not build anything
commercial on it.

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
