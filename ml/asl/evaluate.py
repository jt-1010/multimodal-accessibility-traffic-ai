"""Evaluate a trained sign classifier properly.

    python ml/asl/evaluate.py --data citizen_vocab --checkpoint sign_classifier

Overall accuracy is the least useful number this prints. It hides the two
things that decide whether the terminal works for a real person:

  per-class recall   A model can average 85% while being useless at BURGER.
                     Averages hide the classes that matter most to us.

  per-signer accuracy  A model that works for 40 signers and fails for 3 is a
                     fairness problem, not a rounding error -- and the people
                     it fails are the ones this system exists for.

Also reports the confidence gate, because the segmenter uses a threshold to
decide whether to emit a sign at all, and a threshold that admits every wrong
answer is doing nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from config import ARTIFACTS, PREPARED, feature_spec  # noqa: E402
from model import SignClassifier  # noqa: E402
from train import load, split_by_signer  # noqa: E402


def softmax(logits: np.ndarray) -> np.ndarray:
    z = logits.astype(np.float64)
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="citizen_vocab")
    ap.add_argument("--checkpoint", default="sign_classifier")
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--worst", type=int, default=12, help="how many worst classes to list")
    args = ap.parse_args()

    X, y, signers, labels = load(args.data)
    ckpt_path = ARTIFACTS / f"{args.checkpoint}.pt"
    if not ckpt_path.exists():
        sys.exit(f"No checkpoint at {ckpt_path}")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    if ckpt["labels"] != labels:
        sys.exit(
            f"Label mismatch: checkpoint has {len(ckpt['labels'])} classes, "
            f"{args.data} has {len(labels)}. Evaluating one against the other "
            f"would produce a meaningless number."
        )

    # The same split the model was trained with, so we score only signers it
    # has never seen. Reusing the seed is what makes that reproducible.
    _, val_idx = split_by_signer(signers, y, args.val_frac, args.seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = SignClassifier(len(labels), in_dim=ckpt["in_dim"], frames=ckpt["frames"]).to(device)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()

    with torch.no_grad():
        logits = model(torch.from_numpy(X[val_idx]).float().to(device)).cpu().numpy()

    probs = softmax(logits)
    pred = probs.argmax(1)
    truth = y[val_idx]
    correct = pred == truth
    val_signers = signers[val_idx]

    print(f"\n{'=' * 62}")
    print(f"{args.checkpoint} on {args.data} — signer-independent validation")
    print(f"{'=' * 62}")
    print(f"clips        : {len(val_idx)}")
    print(f"signers      : {len(set(val_signers.tolist()))} (none seen in training)")
    print(f"classes      : {len(labels)}")
    print(f"\ntop-1        : {correct.mean():.3f}")
    k = min(5, probs.shape[1])
    top5 = (np.argsort(-probs, axis=1)[:, :k] == truth[:, None]).any(1)
    print(f"top-{k}        : {top5.mean():.3f}")
    print(f"random guess : {1/len(labels):.3f}")

    # --- per class -------------------------------------------------------
    print(f"\n{'-' * 62}\nWORST CLASSES (recall)\n{'-' * 62}")
    rows = []
    for c, name in enumerate(labels):
        mask = truth == c
        n = int(mask.sum())
        if n == 0:
            continue
        rec = float(correct[mask].mean())
        # What it gets confused with, when it is wrong.
        wrong = pred[mask][~correct[mask]]
        confused = labels[np.bincount(wrong, minlength=len(labels)).argmax()] if len(wrong) else "-"
        rows.append((rec, name, n, confused))

    rows.sort()
    for rec, name, n, confused in rows[: args.worst]:
        bar = "#" * int(rec * 20)
        print(f"  {name:20} {rec:5.2f} {bar:<20} n={n:<4} mostly -> {confused}")

    perfect = sum(1 for r, *_ in rows if r == 1.0)
    print(f"\n  {perfect}/{len(rows)} classes at 100% recall")

    # --- per signer ------------------------------------------------------
    print(f"\n{'-' * 62}\nPER-SIGNER ACCURACY\n{'-' * 62}")
    per = []
    for s in sorted(set(val_signers.tolist())):
        m = val_signers == s
        per.append((float(correct[m].mean()), s, int(m.sum())))
    per.sort()
    for acc, s, n in per:
        bar = "#" * int(acc * 20)
        print(f"  {s:12} {acc:5.2f} {bar:<20} n={n}")

    spread = per[-1][0] - per[0][0]
    print(f"\n  spread: {spread:.2f} between best and worst signer")
    if spread > 0.25:
        print("  NOTE: that is a wide spread. The model works materially better")
        print("  for some people than others -- worth reporting as a fairness")
        print("  finding rather than averaging away.")

    # --- confidence gate -------------------------------------------------
    print(f"\n{'-' * 62}\nCONFIDENCE GATE\n{'-' * 62}")
    top1 = probs.max(1)
    srt = np.sort(probs, axis=1)
    margin = srt[:, -1] - srt[:, -2]
    thr = feature_spec()["segmentation"]["confidence_threshold"]

    for name, score in (("softmax top-1", top1), ("top1 - top2 margin", margin)):
        r, w = score[correct].mean(), score[~correct].mean() if (~correct).any() else float("nan")
        print(f"  {name:20} right {r:.3f}  wrong {w:.3f}  separation {r - w:+.3f}")

    passes = (top1 > thr).mean()
    blocked = (top1[~correct] <= thr).mean() if (~correct).any() else 0.0
    print(f"\n  threshold {thr} passes {passes:.0%} of predictions")
    print(f"  and blocks {blocked:.0%} of the wrong ones")
    if blocked < 0.5:
        print("  NOTE: the gate is letting most errors through. The margin")
        print("  separates better than raw softmax and is the better signal.")


if __name__ == "__main__":
    main()
