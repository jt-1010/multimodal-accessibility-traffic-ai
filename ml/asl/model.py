"""The sign classifier.

Input is a (32, 153) landmark sequence; output is one sign. The shape of the
problem drives every choice here:

  - Tiny inputs. 153 floats per frame, not a 224x224 image. So this is a small
    model by design -- a few million parameters, minutes to train on a laptop.
  - Time matters. Movement is one of the five parameters of ASL phonology and
    distinguishes signs that share a handshape, so the architecture has to see
    the whole sequence at once rather than classify frames independently.
  - Very little data per class. ~31 clips per sign in ASL Citizen. Capacity is
    the enemy: a bigger model memorises the training signers and fails on
    everyone else.

Hence: a small convolutional stem to pick up local motion, a shallow
Transformer to relate the whole sequence, mean-pool, classify.
"""

from __future__ import annotations

import torch
import torch.nn as nn


class ConvStem(nn.Module):
    """Depthwise-separable temporal convolutions.

    Cheap local motion features before the Transformer sees anything. A
    depthwise convolution runs one filter per input channel -- each landmark
    coordinate gets its own little motion detector -- and the pointwise
    convolution then mixes across landmarks. Far fewer parameters than a dense
    convolution, which matters when data is this scarce.
    """

    def __init__(self, in_dim: int, dim: int, kernel: int = 5) -> None:
        super().__init__()
        self.project = nn.Conv1d(in_dim, dim, kernel_size=1)
        self.depthwise = nn.Conv1d(dim, dim, kernel_size=kernel, padding=kernel // 2, groups=dim)
        self.pointwise = nn.Conv1d(dim, dim, kernel_size=1)
        self.norm = nn.BatchNorm1d(dim)
        self.act = nn.GELU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # (B, T, F) -> (B, F, T) for convolution over time
        x = x.transpose(1, 2)
        x = self.project(x)
        x = self.act(self.norm(self.pointwise(self.depthwise(x))))
        return x.transpose(1, 2)


class SignClassifier(nn.Module):
    def __init__(
        self,
        num_classes: int,
        in_dim: int = 153,
        frames: int = 32,
        dim: int = 192,
        depth: int = 4,
        heads: int = 4,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        self.stem = ConvStem(in_dim, dim)

        # Learned positional embedding. The sequence is a fixed 32 frames after
        # resampling, so there is no need for anything fancier.
        self.pos = nn.Parameter(torch.zeros(1, frames, dim))
        nn.init.trunc_normal_(self.pos, std=0.02)

        layer = nn.TransformerEncoderLayer(
            d_model=dim,
            nhead=heads,
            dim_feedforward=dim * 2,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,  # pre-norm: trains more stably at this depth
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=depth)
        self.norm = nn.LayerNorm(dim)
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(dim, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.stem(x) + self.pos
        x = self.encoder(x)
        # Mean-pool over time. A sign is the whole gesture, not a single
        # decisive frame, so averaging beats taking a [CLS] token here and
        # costs no parameters.
        x = self.norm(x.mean(dim=1))
        return self.head(self.drop(x))


def build(num_classes: int, **kwargs) -> SignClassifier:
    model = SignClassifier(num_classes=num_classes, **kwargs)
    params = sum(p.numel() for p in model.parameters())
    print(f"SignClassifier: {num_classes} classes, {params / 1e6:.2f}M parameters")
    return model
