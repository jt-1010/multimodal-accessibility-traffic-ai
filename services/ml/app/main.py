"""SignOrder ML service: sign recognition over WebSocket, plus recommendations."""

from __future__ import annotations

import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .features import feature_length, spec
from .predictor import load_predictor
from .recommender import load_recommender
from .segmenter import SignSegmenter

app = FastAPI(title="SignOrder ML", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PREDICTOR = load_predictor()
RECOMMENDER = load_recommender()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "sign_model": PREDICTOR.name,
        "recommender": RECOMMENDER.name,
        "feature_length": feature_length(),
        "frames": spec()["frames"],
    }


@app.websocket("/ws/sign")
async def ws_sign(ws: WebSocket) -> None:
    """Landmark frames in, sign events out.

    The browser sends one message per camera frame; we reply only when a sign
    actually fires. Staying quiet is the normal case - most frames are a person
    lowering their hands or thinking.
    """
    await ws.accept()
    segmenter = SignSegmenter()
    expected = feature_length()

    try:
        while True:
            msg = await ws.receive_json()

            if msg.get("type") == "reset":
                segmenter.reset()
                continue

            frame = msg.get("lm")
            if not isinstance(frame, list) or len(frame) != expected:
                await ws.send_json(
                    {
                        "type": "error",
                        "message": f"expected {expected} floats, got "
                        f"{len(frame) if isinstance(frame, list) else type(frame).__name__}",
                    }
                )
                continue

            started = time.perf_counter()
            candidate = segmenter.push(frame)
            if candidate is None:
                continue

            label, confidence = PREDICTOR.predict(candidate["window"])
            if not segmenter.accept(label, confidence):
                continue

            await ws.send_json(
                {
                    "type": "sign",
                    "label": label,
                    "confidence": round(confidence, 3),
                    "motion": round(candidate["motion"], 4),
                    "latencyMs": round((time.perf_counter() - started) * 1000, 2),
                    "model": PREDICTOR.name,
                }
            )
    except WebSocketDisconnect:
        pass


class RecommendRequest(BaseModel):
    cart: list[str] = []
    limit: int = 2


@app.post("/recommend")
def recommend(req: RecommendRequest) -> dict:
    return {"recommendations": RECOMMENDER.recommend(req.cart, req.limit)}
