"""Paths and constants shared by the ASL training pipeline.

Datasets are large and live outside the repo. Override any of these with
environment variables rather than editing the file, so teammates on different
machines do not fight over paths in git.

    SIGNORDER_DATA_ROOT   where downloaded datasets live (default: repo data/)
    ASL_CITIZEN_ROOT      the extracted ASL Citizen directory
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# The 46GB ASL Citizen download does not belong on the same drive as the repo
# for most people. Default to the repo's data/ dir; override in the env.
DATA_ROOT = Path(os.environ.get("SIGNORDER_DATA_ROOT", REPO / "data"))

GISLR_ROOT = DATA_ROOT / "asl"
GISLR_LABELS = REPO / "data" / "asl" / "sign_to_prediction_index_map.json"
GISLR_TRAIN_CSV = REPO / "data" / "asl" / "train.csv"

ASL_CITIZEN_ROOT = Path(
    os.environ.get("ASL_CITIZEN_ROOT", DATA_ROOT / "asl-citizen" / "ASL_Citizen")
)

ASL_LEX_CSV = REPO / "data" / "asl-lex" / "signdata.csv"

# Where prepare.py writes the training arrays.
PREPARED = DATA_ROOT / "prepared"
ARTIFACTS = REPO / "ml" / "asl" / "artifacts"

FEATURE_SPEC_PATH = REPO / "ml" / "feature_spec.json"


@lru_cache(maxsize=1)
def feature_spec() -> dict:
    """The one definition of the input vector, shared with the browser."""
    with FEATURE_SPEC_PATH.open(encoding="utf-8") as f:
        return json.load(f)


# --- The landmark subset -------------------------------------------------
#
# GISLR files carry 543 points per frame (face 468, pose 33, hands 21x2). We
# keep 51 of them. Dropping the ~450 face points cuts the input width by 3.5x
# for almost no loss: the mouth matters in ASL, but the cheek contours do not,
# and the model has far less to overfit to.
#
# These indices are into MediaPipe's own numbering, which is what both GISLR
# and our browser emit -- so the same physical landmark carries the same index
# in training and in production.

# NOTE ON LIPS
#
# Mouth morphemes are genuinely phonemic in ASL, and GISLR ships 468 face
# landmarks we could take a lip ring from. We do not use them, because the
# browser would need a third MediaPipe model (FaceLandmarker) running per
# frame to match -- and an input the runtime cannot produce is worse than an
# input we skip. If lip features are ever added, they must be added to
# ml/feature_spec.json and to the browser in the same change.


def pose_indices() -> list[int]:
    return list(feature_spec()["pose_indices"])


def frames() -> int:
    return int(feature_spec()["frames"])


def feature_length() -> int:
    return int(feature_spec()["feature_length"])
