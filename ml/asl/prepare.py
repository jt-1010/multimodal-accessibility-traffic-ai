"""Turn raw datasets into training arrays.

Two very different sources, one output format:

  GISLR        Parquet files of MediaPipe landmarks. Already the right kind of
               data; we select our 51 points and reshape.
  ASL Citizen  MP4 video. We run MediaPipe over it ourselves to produce the
               same landmarks GISLR was built from.

Both end as `(N, 32, 153) float32` plus labels and signer ids.

    python ml/asl/prepare.py gislr
    python ml/asl/prepare.py citizen --vocabulary
    python ml/asl/prepare.py gislr --limit 500      # quick smoke test

THE POINT OF THIS FILE

Normalisation and resampling are imported from `services/ml/app/features.py`
-- the module the live service runs -- rather than reimplemented here. A model
trained on subtly different preprocessing than it is served with degrades
quietly, with nothing to trace. Sharing the code makes that class of bug
impossible rather than merely unlikely.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from config import (
    ARTIFACTS,
    ASL_CITIZEN_ROOT,
    GISLR_LABELS,
    GISLR_TRAIN_CSV,
    PREPARED,
    REPO,
    feature_length,
    frames,
    pose_indices,
)

# The live service's preprocessing, imported rather than copied. See docstring.
sys.path.insert(0, str(REPO / "services" / "ml"))
from app.features import normalize_frame, resample  # noqa: E402

N_HAND_POINTS = 21
DIMS = 3


# ---------------------------------------------------------------------------
# GISLR
# ---------------------------------------------------------------------------

def gislr_clip_to_array(parquet_path: Path) -> np.ndarray | None:
    """One GISLR parquet -> (frames, 153) float32, normalised.

    The file is long-format: one row per landmark per frame, 543 landmarks per
    frame. We keep both hands and nine pose points, in the order the browser
    emits them.
    """
    import pandas as pd

    df = pd.read_parquet(parquet_path, columns=["frame", "type", "landmark_index", "x", "y", "z"])
    if df.empty:
        return None

    poses = pose_indices()
    wanted = df[
        ((df["type"] == "left_hand") & (df["landmark_index"] < N_HAND_POINTS))
        | ((df["type"] == "right_hand") & (df["landmark_index"] < N_HAND_POINTS))
        | ((df["type"] == "pose") & (df["landmark_index"].isin(poses)))
    ]
    if wanted.empty:
        return None

    # Sort key that reproduces the browser's ordering: left hand, right hand,
    # then the pose subset in the order given by feature_spec.
    type_rank = {"left_hand": 0, "right_hand": 1, "pose": 2}
    pose_rank = {idx: i for i, idx in enumerate(poses)}

    wanted = wanted.copy()
    wanted["t_rank"] = wanted["type"].map(type_rank)
    wanted["l_rank"] = np.where(
        wanted["type"] == "pose",
        wanted["landmark_index"].map(pose_rank).fillna(0),
        wanted["landmark_index"],
    )
    wanted = wanted.sort_values(["frame", "t_rank", "l_rank"])

    expected_points = 2 * N_HAND_POINTS + len(poses)
    out = []
    for _, group in wanted.groupby("frame", sort=True):
        if len(group) != expected_points:
            # A frame where MediaPipe found only one hand. GISLR still emits
            # the rows as NaN, so a short group means something else is off.
            continue
        # GISLR uses NaN for undetected landmarks; the browser sends zeros for
        # the same case. Match the browser -- the model must see one convention.
        vec = np.nan_to_num(
            group[["x", "y", "z"]].to_numpy(dtype=np.float32).reshape(-1), nan=0.0
        )
        out.append(normalize_frame(vec))

    if not out:
        return None
    return np.stack(out).astype(np.float32)


def prepare_gislr(limit: int | None, signs: set[str] | None) -> None:
    import pandas as pd

    if not GISLR_TRAIN_CSV.exists():
        zipped = GISLR_TRAIN_CSV.with_suffix(".csv.zip")
        if not zipped.exists():
            sys.exit(
                f"Missing {GISLR_TRAIN_CSV}.\n"
                "Download it with:\n"
                "  python -m kaggle competitions download -c asl-signs -p data/asl"
            )
        index = pd.read_csv(zipped)
    else:
        index = pd.read_csv(GISLR_TRAIN_CSV)

    if signs:
        index = index[index["sign"].isin(signs)]
    if limit:
        index = index.head(limit)

    if index.empty:
        sys.exit("No clips matched. Check --signs.")

    root = GISLR_TRAIN_CSV.parent
    print(f"GISLR: {len(index)} clips, {index['sign'].nunique()} signs, "
          f"{index['participant_id'].nunique()} signers")

    X, y, signers, skipped = [], [], [], 0
    target = frames()

    for i, row in enumerate(index.itertuples(), 1):
        path = root / row.path
        if not path.exists():
            skipped += 1
            continue
        try:
            seq = gislr_clip_to_array(path)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {path.name}: {exc}")
            skipped += 1
            continue
        if seq is None or len(seq) < 2:
            skipped += 1
            continue

        X.append(resample(seq, target).astype(np.float32))
        y.append(row.sign)
        signers.append(str(row.participant_id))

        if i % 500 == 0:
            print(f"  {i}/{len(index)} ({skipped} skipped)")

    if not X:
        sys.exit(
            "Nothing prepared. The landmark files are probably not downloaded:\n"
            "  python -m kaggle competitions download -c asl-signs -p data/asl"
        )

    save("gislr", np.stack(X), y, signers)
    print(f"  skipped {skipped}")


# ---------------------------------------------------------------------------
# ASL Citizen
# ---------------------------------------------------------------------------

def video_to_array(video_path: Path, extractor) -> np.ndarray | None:
    """One MP4 -> (frames, 153) float32, normalised.

    This is the step that makes ASL Citizen usable: it ships video, and we need
    the same landmarks GISLR already provides.
    """
    import cv2

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step_ms = max(1, int(1000 / fps))
    out = []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            # The extractor owns the clock. MediaPipe's VIDEO mode requires
            # timestamps that increase across the landmarker's whole lifetime,
            # not per clip -- and we reuse one landmarker across every video
            # because loading the models takes seconds. Passing each clip's own
            # timestamps starting at zero throws on the second clip.
            vec = extractor(frame, step_ms)
            if vec is not None:
                out.append(normalize_frame(vec))
    finally:
        cap.release()

    extractor.next_clip()

    if not out:
        return None
    return np.stack(out).astype(np.float32)


def make_extractor():
    """MediaPipe hands + pose, emitting our 153-value vector.

    Uses the **same .task model files the browser loads** from
    web/public/models/, through the same Tasks API family. Not a convenience:
    a different pose model, or a different version of the same one, would put
    landmarks in slightly different places, and the model would be trained on
    a distribution it never sees in production.
    """
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    models = REPO / "web" / "public" / "models"
    hand_model = models / "hand_landmarker.task"
    pose_model = models / "pose_landmarker_lite.task"
    for m in (hand_model, pose_model):
        if not m.exists():
            sys.exit(f"Missing {m}. Run: npm --prefix web run setup")

    hands = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(hand_model)),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
        )
    )
    pose = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(pose_model)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
    )

    poses = pose_indices()
    empty_hand = [0.0] * (N_HAND_POINTS * DIMS)

    # Monotonic across every clip this extractor ever sees. See video_to_array.
    clock = {"ms": 0}

    def extract(bgr, step_ms: int) -> np.ndarray | None:
        clock["ms"] += step_ms
        timestamp_ms = clock["ms"]

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        h_res = hands.detect_for_video(image, timestamp_ms)
        p_res = pose.detect_for_video(image, timestamp_ms)

        # No body means no usable frame: normalisation needs both shoulders.
        if not p_res.pose_landmarks:
            return None

        left, right = list(empty_hand), list(empty_hand)
        for i, lm in enumerate(h_res.hand_landmarks or []):
            flat = [c for p in lm[:N_HAND_POINTS] for c in (p.x, p.y, p.z)]
            # Handedness label verbatim, matching the browser, which also does
            # not correct for the mirrored preview.
            label = None
            if h_res.handedness and i < len(h_res.handedness):
                label = h_res.handedness[i][0].category_name
            if label == "Left":
                left = flat
            elif label == "Right":
                right = flat
            elif left == empty_hand:
                left = flat
            else:
                right = flat

        pl = p_res.pose_landmarks[0]
        body = [c for i in poses for c in (pl[i].x, pl[i].y, pl[i].z)]

        vec = np.asarray(left + right + body, dtype=np.float32)
        return vec if len(vec) == feature_length() else None

    def next_clip():
        """Jump the clock forward so clips never blur into one another.

        A full second of gap: MediaPipe smooths between adjacent frames, and
        without a break the last frame of one signer would inform the first
        frame of the next.
        """
        clock["ms"] += 1000

    def close():
        hands.close()
        pose.close()

    extract.next_clip = next_clip  # type: ignore[attr-defined]
    extract.close = close  # type: ignore[attr-defined]
    return extract


def prepare_citizen(limit: int | None, signs: set[str] | None) -> None:
    import csv

    if not ASL_CITIZEN_ROOT.exists():
        sys.exit(
            f"ASL Citizen not found at {ASL_CITIZEN_ROOT}.\n"
            "Download and unzip it, then set ASL_CITIZEN_ROOT, e.g.\n"
            "  set ASL_CITIZEN_ROOT=D:\\signorder-data\\asl-citizen\\ASL_Citizen"
        )

    # The distribution ships train/val/test splits as CSVs alongside the videos.
    splits = sorted(ASL_CITIZEN_ROOT.rglob("*.csv"))
    if not splits:
        sys.exit(f"No split CSVs under {ASL_CITIZEN_ROOT}. Is the zip fully extracted?")

    rows = []
    for csv_path in splits:
        with csv_path.open(encoding="utf-8", errors="replace") as f:
            for r in csv.DictReader(f):
                rows.append({k.strip().lower(): v for k, v in r.items() if k})

    if not rows:
        sys.exit("Split CSVs were empty.")

    print(f"ASL Citizen index: {len(rows)} rows from {len(splits)} split files")
    print(f"  columns: {sorted(rows[0].keys())}")

    def field(row, *names):
        for n in names:
            if n in row and row[n]:
                return row[n]
        return None

    if signs:
        rows = [r for r in rows if (field(r, "gloss", "sign", "label") or "").lower() in signs]
    if limit:
        rows = rows[:limit]
    if not rows:
        sys.exit("No rows matched. Check --signs against the gloss column.")

    print(f"  preparing {len(rows)} clips")
    extractor = make_extractor()

    X, y, signers, skipped = [], [], [], 0
    target = frames()

    for i, r in enumerate(rows, 1):
        rel = field(r, "video file", "video_file", "filename", "path")
        gloss = field(r, "gloss", "sign", "label")
        if not rel or not gloss:
            skipped += 1
            continue

        matches = list(ASL_CITIZEN_ROOT.rglob(Path(rel).name))
        if not matches:
            skipped += 1
            continue

        seq = video_to_array(matches[0], extractor)
        if seq is None or len(seq) < 2:
            skipped += 1
            continue

        X.append(resample(seq, target).astype(np.float32))
        y.append(gloss.lower())
        # No participant column in every release; fall back to the signer id if
        # present, else the filename stem, so the split can still group by clip.
        signers.append(str(field(r, "participant id", "participant_id", "signer") or Path(rel).stem))

        if i % 25 == 0:
            print(f"  {i}/{len(rows)} ({skipped} skipped)")

    if not X:
        sys.exit("Nothing prepared from ASL Citizen.")

    extractor.close()
    save("citizen", np.stack(X), y, signers)
    print(f"  skipped {skipped}")


# ---------------------------------------------------------------------------

def save(name: str, X: np.ndarray, y: list[str], signers: list[str]) -> None:
    PREPARED.mkdir(parents=True, exist_ok=True)
    ARTIFACTS.mkdir(parents=True, exist_ok=True)

    labels = sorted(set(y))
    label_to_idx = {s: i for i, s in enumerate(labels)}
    y_idx = np.asarray([label_to_idx[s] for s in y], dtype=np.int64)

    np.save(PREPARED / f"{name}_X.npy", X)
    np.save(PREPARED / f"{name}_y.npy", y_idx)
    np.save(PREPARED / f"{name}_signers.npy", np.asarray(signers))
    with (PREPARED / f"{name}_labels.json").open("w", encoding="utf-8") as f:
        json.dump(labels, f, indent=2)

    mb = X.nbytes / 1e6
    print(f"\nWrote {PREPARED / (name + '_X.npy')}")
    print(f"  shape {X.shape}  ({mb:.1f} MB)")
    print(f"  {len(labels)} classes, {len(set(signers))} signers")
    print(f"  min/max after normalisation: {X.min():.2f} / {X.max():.2f}")


def load_vocabulary() -> set[str]:
    """The ordering vocabulary, from vocabulary.py rather than a second list."""
    sys.path.insert(0, str(Path(__file__).parent))
    from vocabulary import ORDERING_VOCABULARY

    return {g for glosses in ORDERING_VOCABULARY.values() for g in glosses}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", choices=["gislr", "citizen"])
    ap.add_argument("--limit", type=int, help="stop after N clips (smoke test)")
    ap.add_argument(
        "--vocabulary",
        action="store_true",
        help="keep only signs in the ordering vocabulary",
    )
    ap.add_argument("--signs", nargs="*", help="explicit list of glosses to keep")
    args = ap.parse_args()

    signs: set[str] | None = None
    if args.vocabulary:
        signs = load_vocabulary()
        print(f"Filtering to the ordering vocabulary ({len(signs)} glosses)")
    elif args.signs:
        signs = {s.lower() for s in args.signs}

    if args.source == "gislr":
        prepare_gislr(args.limit, signs)
    else:
        prepare_citizen(args.limit, signs)


if __name__ == "__main__":
    main()
