"""Export the trained model to ONNX for the inference service.

    python ml/asl/export.py

Writes ml/asl/artifacts/sign_classifier.onnx. services/ml checks for exactly
that path on startup, so the moment this succeeds the service stops running
NullPredictor and the UI stops saying "model not trained yet".

The export is verified, not assumed: PyTorch and ONNX Runtime are run on the
same input and their outputs compared. An export that silently changes the
maths would show up in production as a model that trained well and predicts
badly, which is a miserable thing to debug.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch

# torch.onnx prints status lines containing emoji. On a Windows console the
# default cp1252 codec cannot encode them and the export dies with a
# UnicodeEncodeError -- after doing all the work, and with a traceback that
# points at a print statement rather than anything real.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent))
from config import ARTIFACTS  # noqa: E402
from model import SignClassifier  # noqa: E402

CHECKPOINT = ARTIFACTS / "sign_classifier.pt"
ONNX_PATH = ARTIFACTS / "sign_classifier.onnx"


def main() -> None:
    if not CHECKPOINT.exists():
        sys.exit(f"No checkpoint at {CHECKPOINT}. Run ml/asl/train.py first.")

    ckpt = torch.load(CHECKPOINT, map_location="cpu", weights_only=False)
    labels = ckpt["labels"]
    in_dim, frames = ckpt["in_dim"], ckpt["frames"]

    model = SignClassifier(num_classes=len(labels), in_dim=in_dim, frames=frames)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    # Batch stays dynamic so the service can score several windows at once if
    # it ever needs to; the time and feature axes are fixed by feature_spec.
    dummy = torch.randn(1, frames, in_dim)
    torch.onnx.export(
        model,
        dummy,
        str(ONNX_PATH),
        input_names=["landmarks"],
        output_names=["logits"],
        dynamic_axes={"landmarks": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=18,
        # Force the legacy TorchScript exporter. torch 2.11 defaults to the
        # dynamo path, which ignored dynamic_axes here and baked the batch
        # dimension into a Reshape: the model then ran at batch 1 and raised a
        # shape error on anything else. It also emits a separate .onnx.data
        # file, which the service does not expect.
        dynamo=False,
    )

    with (ARTIFACTS / "labels.json").open("w", encoding="utf-8") as f:
        json.dump(labels, f, indent=2)

    size_mb = ONNX_PATH.stat().st_size / 1e6
    print(f"Wrote {ONNX_PATH} ({size_mb:.1f} MB, {len(labels)} classes)")

    # --- verify the export actually computes the same thing ---
    try:
        import onnxruntime as ort
    except ImportError:
        print("onnxruntime not installed; skipping numerical check.")
        return

    session = ort.InferenceSession(str(ONNX_PATH), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(0)
    worst = 0.0

    # Several batch sizes, not just one. An earlier version checked batch=1
    # only and passed an export whose batch dimension had been baked in --
    # which works in the service, since it scores a single window, and fails
    # the moment anything evaluates a batch.
    for batch in (1, 2, 8, 64):
        x = rng.standard_normal((batch, frames, in_dim)).astype(np.float32)
        with torch.no_grad():
            torch_out = model(torch.from_numpy(x)).numpy()
        try:
            onnx_out = session.run(None, {"landmarks": x})[0]
        except Exception as exc:  # noqa: BLE001
            sys.exit(f"ONNX model failed at batch size {batch}: {exc}")
        if onnx_out.shape != torch_out.shape:
            sys.exit(f"Shape mismatch at batch {batch}: {onnx_out.shape} vs {torch_out.shape}")
        diff = float(np.abs(torch_out - onnx_out).max())
        worst = max(worst, diff)
        print(f"  batch {batch:3}: max |torch - onnx| = {diff:.2e}")

    if worst > 1e-4:
        sys.exit("Export does not match PyTorch. Do not ship this model.")
    print("Export verified across batch sizes.")
    print("\nRestart services/ml and it will load the model automatically.")


if __name__ == "__main__":
    main()
