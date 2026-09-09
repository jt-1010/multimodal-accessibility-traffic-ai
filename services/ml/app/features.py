"""Landmark feature extraction, driven by the shared spec.

Both this module and the browser read ml/feature_spec.json. That file is the
contract: if training and inference ever disagree about which landmarks go
into the vector or how they are normalised, the model degrades quietly and the
cause is close to impossible to spot from the outside.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

SPEC_PATH = Path(__file__).resolve().parents[3] / "ml" / "feature_spec.json"


@lru_cache(maxsize=1)
def spec() -> dict:
    with SPEC_PATH.open() as f:
        return json.load(f)


def feature_length() -> int:
    return int(spec()["feature_length"])


def normalize_frame(vec: np.ndarray) -> np.ndarray:
    """Centre on the shoulder midpoint, scale by shoulder width.

    Removes where the person is standing and how big they are from the signal,
    leaving the shape of the sign. Without this the model spends its capacity
    memorising camera placement.
    """
    s = spec()
    n_hand = s["hands"]["count"] * s["hands"]["points_per_hand"]
    dims = s["dims"]
    pose_names = s["pose_index_names"]

    pts = vec.reshape(-1, dims).copy()
    pose = pts[n_hand:]

    li = pose_names.index("left_shoulder")
    ri = pose_names.index("right_shoulder")
    l_sh, r_sh = pose[li], pose[ri]

    mid = (l_sh + r_sh) / 2.0
    width = float(np.linalg.norm(l_sh[:2] - r_sh[:2]))
    if width < 1e-6:
        # No shoulders visible this frame; leave it alone rather than divide by
        # near-zero and emit garbage the model has never seen.
        return vec

    pts = (pts - mid) / width
    return pts.reshape(-1)


def resample(window: np.ndarray, target_frames: int) -> np.ndarray:
    """Linearly resample a (T, F) window to (target_frames, F).

    Signs are performed at different speeds by different people. Fixing the
    frame count makes duration a non-feature, which is what we want -- the same
    sign made slowly is still that sign.
    """
    t = window.shape[0]
    if t == target_frames:
        return window
    src = np.linspace(0.0, 1.0, t)
    dst = np.linspace(0.0, 1.0, target_frames)
    return np.stack([np.interp(dst, src, window[:, c]) for c in range(window.shape[1])], axis=1)
