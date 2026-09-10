"""Guards against train/serve skew.

The dangerous failure in this pipeline is not a crash. It is the browser
putting the right hand where the trainer put the left, producing a vector of
the correct length and entirely wrong meaning. Nothing throws; accuracy just
collapses in production for no visible reason.

These tests pin the layout so that cannot happen silently.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
ML_ASL = HERE.parent
REPO = ML_ASL.parents[1]

sys.path.insert(0, str(ML_ASL))
sys.path.insert(0, str(REPO / "services" / "ml"))

from config import feature_length, frames, pose_indices  # noqa: E402
from prepare import N_HAND_POINTS, gislr_clip_to_array  # noqa: E402

pd = pytest.importorskip("pandas")

DIMS = 3
LEFT_END = N_HAND_POINTS * DIMS            # 63
RIGHT_END = LEFT_END + N_HAND_POINTS * DIMS  # 126


def synthetic_clip(tmp_path: Path, n_frames: int = 4) -> Path:
    """A GISLR-shaped parquet where every landmark is tagged with its identity.

    x encodes which body part (1=left hand, 2=right hand, 3=pose) and y encodes
    the landmark index, so the flattened output can be checked position by
    position.
    """
    poses = pose_indices()
    rows = []
    for frame in range(n_frames):
        for i in range(N_HAND_POINTS):
            rows.append(dict(frame=frame, type="left_hand", landmark_index=i, x=1.0, y=float(i), z=0.0))
        for i in range(N_HAND_POINTS):
            rows.append(dict(frame=frame, type="right_hand", landmark_index=i, x=2.0, y=float(i), z=0.0))
        for i in poses:
            # Shoulders must be plausible or normalisation divides by ~zero.
            if i == 11:
                rows.append(dict(frame=frame, type="pose", landmark_index=i, x=0.4, y=0.4, z=0.0))
            elif i == 12:
                rows.append(dict(frame=frame, type="pose", landmark_index=i, x=0.6, y=0.4, z=0.0))
            else:
                rows.append(dict(frame=frame, type="pose", landmark_index=i, x=3.0, y=float(i), z=0.0))
        # Face landmarks are present in real files and must be ignored.
        for i in range(5):
            rows.append(dict(frame=frame, type="face", landmark_index=i, x=9.0, y=9.0, z=9.0))

    path = tmp_path / "clip.parquet"
    pd.DataFrame(rows).to_parquet(path)
    return path


def test_output_width_matches_the_shared_spec(tmp_path):
    seq = gislr_clip_to_array(synthetic_clip(tmp_path))
    assert seq is not None
    assert seq.shape[1] == feature_length() == 153


def test_landmark_order_is_left_hand_then_right_hand_then_pose(tmp_path):
    """The browser emits this order. The trainer must emit the same one."""
    seq = gislr_clip_to_array(synthetic_clip(tmp_path))
    # Undo normalisation is not possible, so check on raw ordering instead:
    # x was 1.0 for every left-hand point and 2.0 for every right-hand point,
    # so after an identical affine transform the two blocks must still differ
    # and stay internally constant.
    frame0 = seq[0]
    left_x = frame0[0:LEFT_END:DIMS]
    right_x = frame0[LEFT_END:RIGHT_END:DIMS]

    assert np.allclose(left_x, left_x[0]), "left-hand block is not contiguous"
    assert np.allclose(right_x, right_x[0]), "right-hand block is not contiguous"
    assert not np.isclose(left_x[0], right_x[0]), "hands are not separated"
    assert left_x[0] < right_x[0], "left and right hand blocks are swapped"


def test_face_landmarks_are_excluded(tmp_path):
    """543 landmarks in, 51 out.

    Asserted as an invariance rather than a magnitude check: adding face rows
    must not change the output at all. That is the actual property we need,
    and unlike a threshold on values it cannot be fooled by whatever the pose
    coordinates happen to be.
    """
    poses = pose_indices()

    def build(with_face: bool) -> Path:
        rows = []
        for i in range(N_HAND_POINTS):
            rows.append(dict(frame=0, type="left_hand", landmark_index=i, x=0.3, y=float(i) / 100, z=0.0))
            rows.append(dict(frame=0, type="right_hand", landmark_index=i, x=0.7, y=float(i) / 100, z=0.0))
        for i in poses:
            x = 0.4 if i == 11 else 0.6 if i == 12 else 0.5
            rows.append(dict(frame=0, type="pose", landmark_index=i, x=x, y=0.4, z=0.0))
        if with_face:
            for i in range(468):
                rows.append(dict(frame=0, type="face", landmark_index=i, x=9.0, y=9.0, z=9.0))

        path = tmp_path / f"face_{with_face}.parquet"
        pd.DataFrame(rows).to_parquet(path)
        return path

    without = gislr_clip_to_array(build(False))
    with_face = gislr_clip_to_array(build(True))

    assert without is not None and with_face is not None
    assert without.shape[1] == 51 * DIMS
    assert np.allclose(without, with_face), "face landmarks changed the output"


def test_missing_hand_becomes_zeros_not_nan(tmp_path):
    """GISLR uses NaN for an undetected hand; the browser sends zeros.

    Training on NaN and serving zeros would be a silent distribution shift, so
    the loader must convert. A NaN reaching the model poisons the whole batch.
    """
    poses = pose_indices()
    rows = []
    for i in range(N_HAND_POINTS):
        rows.append(dict(frame=0, type="left_hand", landmark_index=i,
                         x=float("nan"), y=float("nan"), z=float("nan")))
        rows.append(dict(frame=0, type="right_hand", landmark_index=i, x=0.5, y=0.5, z=0.0))
    for i in poses:
        x = 0.4 if i == 11 else 0.6 if i == 12 else 0.5
        rows.append(dict(frame=0, type="pose", landmark_index=i, x=x, y=0.4, z=0.0))

    path = tmp_path / "nan.parquet"
    pd.DataFrame(rows).to_parquet(path)

    seq = gislr_clip_to_array(path)
    assert seq is not None
    assert not np.isnan(seq).any(), "NaN survived into the training vector"


def test_resample_reaches_the_configured_frame_count(tmp_path):
    from app.features import resample

    for n in (2, 7, 32, 120):
        seq = gislr_clip_to_array(synthetic_clip(tmp_path, n_frames=n))
        assert seq is not None
        assert resample(seq, frames()).shape == (frames(), feature_length())
