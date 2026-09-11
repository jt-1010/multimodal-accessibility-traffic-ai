"""Train the sign classifier.

    python ml/asl/train.py --data citizen --epochs 60

THE SPLIT IS THE POINT

Data is split **by signer**, never at random. A random split puts the same
person in train and test, and the model scores well by recognising *them* --
their proportions, their camera, their habits -- rather than the sign. The
number that comes out is inflated and means nothing about a stranger walking
up to the terminal.

A signer-independent split gives a lower number that is actually about signs.
That is the one to report, and the one to optimise.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

sys.path.insert(0, str(Path(__file__).parent))
from config import ARTIFACTS, PREPARED  # noqa: E402
from model import build  # noqa: E402


def load(name: str):
    X = np.load(PREPARED / f"{name}_X.npy")
    y = np.load(PREPARED / f"{name}_y.npy")
    signers = np.load(PREPARED / f"{name}_signers.npy")
    with (PREPARED / f"{name}_labels.json").open(encoding="utf-8") as f:
        labels = json.load(f)
    return X, y, signers, labels


def split_by_signer(signers: np.ndarray, y: np.ndarray, val_frac: float, seed: int):
    """Hold out whole signers, not random clips.

    Signers are assigned greedily smallest-first so the validation set lands
    near the requested size without splitting anyone across both sides.
    """
    rng = np.random.default_rng(seed)
    unique = np.unique(signers)

    if len(unique) < 2:
        # Single-signer data (our own recordings, before we have several
        # people). Fall back to a random split and say so loudly -- the
        # resulting accuracy is not signer-independent and must not be
        # reported as if it were.
        print("  WARNING: only one signer in this data.")
        print("  Falling back to a RANDOM split. Accuracy will be optimistic")
        print("  and is NOT comparable to a signer-independent number.")
        idx = rng.permutation(len(y))
        cut = int(len(idx) * (1 - val_frac))
        return idx[:cut], idx[cut:]

    rng.shuffle(unique)
    target = int(len(y) * val_frac)
    val_signers, held = [], 0
    for s in unique:
        if held >= target and len(val_signers) > 0:
            break
        val_signers.append(s)
        held += int((signers == s).sum())

    val_mask = np.isin(signers, val_signers)
    train_idx = np.flatnonzero(~val_mask)
    val_idx = np.flatnonzero(val_mask)

    print(f"  train: {len(train_idx)} clips from {len(unique) - len(val_signers)} signers")
    print(f"  val  : {len(val_idx)} clips from {len(val_signers)} signers (held out entirely)")
    return train_idx, val_idx


def augment(batch: torch.Tensor) -> torch.Tensor:
    """Cheap, label-preserving jitter.

    With ~31 clips per sign, augmentation is doing a lot of the work. All three
    of these mimic real variation -- where someone stands, how big they sign,
    and frames MediaPipe drops -- rather than adding abstract noise.
    """
    b = batch.shape[0]
    # Global translation: the person stands slightly off-centre.
    batch = batch + torch.randn(b, 1, 1, device=batch.device) * 0.02
    # Global scale: bigger or smaller signing.
    batch = batch * (1 + torch.randn(b, 1, 1, device=batch.device) * 0.05)
    # Frame dropout: tracking blinks. Zeroing matches what the browser sends
    # when a hand is not detected, so the model sees the real failure mode.
    mask = (torch.rand(b, batch.shape[1], 1, device=batch.device) > 0.05).float()
    return batch * mask


def run(args) -> None:
    X, y, signers, labels = load(args.data)
    print(f"{args.data}: {X.shape[0]} clips, {len(labels)} classes, {len(np.unique(signers))} signers")

    counts = np.bincount(y, minlength=len(labels))
    print(f"  clips per class: min {counts.min()}, median {int(np.median(counts))}, max {counts.max()}")

    train_idx, val_idx = split_by_signer(signers, y, args.val_frac, args.seed)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"  device: {device}")

    Xt = torch.from_numpy(X).float()
    yt = torch.from_numpy(y).long()

    train_ds = TensorDataset(Xt[train_idx], yt[train_idx])
    val_ds = TensorDataset(Xt[val_idx], yt[val_idx])
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True, drop_last=False)
    val_dl = DataLoader(val_ds, batch_size=args.batch)

    model = build(len(labels), in_dim=X.shape[2], frames=X.shape[1]).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=args.epochs * max(1, len(train_dl)), pct_start=0.2
    )
    # Label smoothing: with this little data the model would otherwise become
    # overconfident on the training signers.
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)

    best, best_state, patience = 0.0, None, 0
    ARTIFACTS.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        for xb, yb in train_dl:
            xb, yb = xb.to(device), yb.to(device)
            xb = augment(xb)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            total_loss += loss.item() * len(xb)

        model.eval()
        correct = top5 = seen = 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(device), yb.to(device)
                logits = model(xb)
                correct += (logits.argmax(1) == yb).sum().item()
                k = min(5, logits.shape[1])
                top5 += (logits.topk(k, dim=1).indices == yb[:, None]).any(1).sum().item()
                seen += len(yb)

        acc = correct / max(1, seen)
        acc5 = top5 / max(1, seen)
        if epoch % 5 == 0 or epoch == 1:
            print(f"  epoch {epoch:3}  loss {total_loss/len(train_idx):.3f}  "
                  f"val top1 {acc:.3f}  top5 {acc5:.3f}")

        if acc > best:
            best, patience = acc, 0
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        else:
            patience += 1
            if patience >= args.patience:
                print(f"  early stop at epoch {epoch} (no improvement for {args.patience})")
                break

    print(f"\nBEST signer-independent top-1: {best:.3f}")

    if best_state is not None:
        model.load_state_dict(best_state)
    torch.save({"state_dict": model.state_dict(), "labels": labels,
                "in_dim": X.shape[2], "frames": X.shape[1]},
               ARTIFACTS / "sign_classifier.pt")
    with (ARTIFACTS / "labels.json").open("w", encoding="utf-8") as f:
        json.dump(labels, f, indent=2)
    print(f"Wrote {ARTIFACTS / 'sign_classifier.pt'}")
    print("Next: python ml/asl/export.py")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="citizen", help="prepared dataset name")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--patience", type=int, default=15)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    run(args)


if __name__ == "__main__":
    main()
