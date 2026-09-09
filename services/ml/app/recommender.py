"""Order recommendations.

`CooccurrenceRecommender` is the baseline the trained next-item model has to
beat in the Recall@k evaluation. It is intentionally simple and intentionally
kept: a baseline you can explain in one sentence is what makes a reported
improvement mean anything.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

ARTIFACT_DIR = Path(__file__).resolve().parents[3] / "ml" / "recsys" / "artifacts"
MATRIX_PATH = ARTIFACT_DIR / "cooccurrence.json"


class Recommender(Protocol):
    name: str

    def recommend(self, cart: list[str], limit: int) -> list[dict]: ...


class CooccurrenceRecommender:
    name = "cooccurrence"

    def __init__(self, matrix: dict[str, dict[str, float]]) -> None:
        self.matrix = matrix

    def recommend(self, cart: list[str], limit: int) -> list[dict]:
        if not cart:
            return []

        scores: dict[str, float] = {}
        for slug in cart:
            for other, weight in self.matrix.get(slug, {}).items():
                if other in cart:
                    continue
                scores[other] = scores.get(other, 0.0) + weight

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:limit]
        return [
            {"slug": slug, "name": slug, "priceCents": 0, "reason": "often ordered together"}
            for slug, _ in ranked
        ]


class NullRecommender:
    """Returns nothing, so the kiosk falls back to its own rules baseline."""

    name = "none"

    def recommend(self, cart: list[str], limit: int) -> list[dict]:
        return []


def load_recommender() -> Recommender:
    if MATRIX_PATH.exists():
        with MATRIX_PATH.open() as f:
            print(f"[recsys] loaded {MATRIX_PATH.name}")
            return CooccurrenceRecommender(json.load(f))
    print(f"[recsys] no matrix at {MATRIX_PATH}, the app will use its rules baseline")
    return NullRecommender()
