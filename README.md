# SignOrder — Multimodal Accessible Ordering Kiosk

An ordering kiosk that takes a complete food order in **American Sign Language**, speech, or touch.
It notices when someone walks up, greets them in every modality at once, and adapts to whichever
channel the person actually uses.

CMPE 295A · San José State University · Advisor: Prof. Vidhyacharan Bhaskar

> **Note:** the repository is still named `multimodal-accessibility-traffic-ai` for historical
> reasons. The project is ASL accessible ordering only.

## Why landmarks, not video

The browser runs MediaPipe locally and streams only **hand/pose/lip landmark coordinates** to the
server — a few KB per frame instead of megabytes of video. Three consequences:

1. **Latency.** Round trip stays under ~100ms, which is what makes the kiosk feel conversational.
2. **Privacy.** No camera imagery is ever transmitted or stored. Only coordinates leave the device.
3. **No train/serve skew.** Our training data (Google ISLR) *is* MediaPipe landmarks, so the model
   sees the same representation in training and in production.

## Prices are never generated

The menu lives in Postgres and is reached through tool calls. The language model handles conversation
and ASL gloss reordering (`WANT / BURGER / TWO` → a structured cart action) but never invents an item
or a price. A kiosk that quotes a wrong price is worse than no kiosk.

## Architecture

```
Browser (Chrome)                  Next.js /api/agent          FastAPI services/ml
  MediaPipe → landmarks  ──WS──────────────────────────────►  ASL classifier (ONNX)
  Face detect → presence                                       recommender
  Web Speech → STT/TTS   ──SSE──►  tool-calling agent  ──────►
                                          │
                                          ▼
                                   Postgres: menu · cart · orders
```

## Layout

| Path | What |
|---|---|
| `apps/kiosk` | Next.js + TypeScript + Tailwind kiosk UI and agent route |
| `services/ml` | FastAPI: sign recognition WebSocket, recommender |
| `ml/asl` | ASL classifier: data prep, training, eval, ONNX export |
| `ml/recsys` | Order recommender training |
| `ml/llm` | Synthetic dialogues, QLoRA fine-tune, GGUF export |
| `ml/collect` | Tool for recording our own ordering signs |
| `docs` | Spec, ADRs, figures |

## Getting started

See [docs/development.md](docs/development.md).

## The three models we train

1. **ASL sign classifier** — Transformer over landmark sequences, ~280 signs. The centerpiece.
2. **Order recommender** — next-item model over cart state; drives specials and upsells.
3. **Conversational LLM** — Qwen2.5-3B QLoRA fine-tuned on synthetic ordering dialogues, served
   locally via Ollama, benchmarked against a hosted baseline.

Full design: [docs/spec.md](docs/spec.md).
