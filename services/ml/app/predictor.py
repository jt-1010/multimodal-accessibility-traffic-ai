"""Sign classification.

Two implementations behind one interface. `OnnxPredictor` is the real trained
model from ml/asl. `StubPredictor` stands in until that model exists.

The stub is not throwaway scaffolding - it is how M0 gets built. Wiring the
browser, the segmenter, the agent and speech together while the classifier is
a known quantity means that when the real model lands, any breakage is
unambiguously the model's. Debugging a novel pipeline and a novel model at the
same time is how weeks disappear.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

import numpy as np

ARTIFACT_DIR = Path(__file__).resolve().parents[3] / "ml" / "asl" / "artifacts"
MODEL_PATH = ARTIFACT_DIR / "sign_classifier.onnx"
LABELS_PATH = ARTIFACT_DIR / "labels.json"


class Predictor(Protocol):
    name: str

    def predict(self, window: np.ndarray) -> tuple[str, float]: ...


class StubPredictor:
    """Cycles a demo vocabulary so the full pipeline can be exercised."""

    name = "stub"

    DEMO_SEQUENCE = [
        "WANT",
        "BURGER",
        "TWO",
        "FRIES",
        "DRINK",
        "FINISH",
    ]

    def __init__(self) -> None:
        self._i = 0

    def predict(self, window: np.ndarray) -> tuple[str, float]:
        label = self.DEMO_SEQUENCE[self._i % len(self.DEMO_SEQUENCE)]
        self._i += 1
        # Deliberately above the segmenter's confidence threshold so the stub
        # always emits; the real model will not be this generous.
        return label, 0.95


class OnnxPredictor:
    """The trained landmark Transformer, exported to ONNX."""

    name = "onnx"

    def __init__(self) -> None:
        import onnxruntime as ort  # imported lazily: optional dependency

        self.session = ort.InferenceSession(
            str(MODEL_PATH), providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        with LABELS_PATH.open() as f:
            self.labels: list[str] = json.load(f)

    def predict(self, window: np.ndarray) -> tuple[str, float]:
        batch = window[None, :, :].astype(np.float32)
        logits = self.session.run(None, {self.input_name: batch})[0][0]

        # Softmax in float64: exp() on float32 logits overflows for confident
        # predictions, which shows up as nan confidence and silently dropped signs.
        z = logits.astype(np.float64)
        e = np.exp(z - z.max())
        probs = e / e.sum()

        idx = int(probs.argmax())
        return self.labels[idx], float(probs[idx])


def load_predictor() -> Predictor:
    if MODEL_PATH.exists() and LABELS_PATH.exists():
        try:
            predictor = OnnxPredictor()
            print(f"[sign] loaded trained model: {MODEL_PATH.name}")
            return predictor
        except Exception as exc:  # noqa: BLE001
            # Never fall back silently. A stub quietly standing in for a model
            # you believe is loaded is a genuinely dangerous failure mode.
            print(f"[sign] FAILED to load {MODEL_PATH}: {exc}")
            print("[sign] falling back to StubPredictor - predictions are FAKE")
    else:
        print(f"[sign] no trained model at {MODEL_PATH}, using StubPredictor")
    return StubPredictor()
