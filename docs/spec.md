# SignOrder — Multimodal Accessible Ordering Kiosk (CMPE 295A)

## Context

**The problem.** Self-service ordering kiosks and drive-thrus are effectively closed to people who
communicate in ASL, and voice-only ordering systems are closed to people who are Deaf or
speech-impaired. Existing translation apps support a narrow set of input types and none of them
handle a transactional task like ordering, where the system must be *correct about prices*, not just
fluent. This is the "Assistive Tech (ASL Translation)" scenario the advisor proposed on June 3rd.

**What we're building.** A browser-based kiosk that notices a person is present, greets them in every
modality at once, and takes a complete food order through ASL, speech, or touch — conversationally,
with sub-second response, adapting to whichever channel the person actually uses.

**Scope.** Accessible ASL ordering, end to end. Nothing else. The whole repo is this project.

**Repo.** `git@github.com:jt-1010/multimodal-accessibility-traffic-ai.git` — the name is a leftover and
should be renamed to match the project (e.g. `signorder`), which needs admin rights on Jeremy's
account. Not a blocker; use it as-is until then.

**Verified environment.** SSH to GitHub already authenticates as `rl4658`; `git ls-remote` on the repo
returns a `main` branch, so read access is confirmed. Push access is unverified — confirm Jeremy has
added you as a collaborator before Milestone 0. Node v24.14.0, Python 3.14, and Git 2.45.1 are installed.

---

## Design decisions (from brainstorming)

| Decision | Choice |
|---|---|
| ASL recognition | 250-sign landmark model (Google ISLR) + ~30 self-recorded ordering signs |
| Models we train | ASL classifier, order recommender, **and** a QLoRA fine-tuned local LLM |
| Frontend | Next.js (App Router) + TypeScript + Tailwind |
| ML backend | Python FastAPI |
| Demo target | Chrome on a laptop webcam |
| Training compute | Free Colab / Kaggle T4 |

---

## Architecture

```
┌─ Browser (Chrome kiosk) ────────────────────────────────┐
│  MediaPipe Tasks (WASM)                                  │
│    • Face Detector    → presence trigger                 │
│    • Hand + Pose      → 543 landmarks @ 30fps            │
│  Web Speech API       → STT in / TTS out                 │
│  Raw video NEVER leaves the browser                      │
└──────┬───────────────────────────────┬───────────────────┘
       │ WebSocket (landmarks, ~4KB/f) │ HTTP/SSE
       ▼                               ▼
┌─ FastAPI  services/ml ──┐   ┌─ Next.js  apps/kiosk ──────┐
│  /ws/sign  → ASL model  │   │  /api/agent  (AI SDK v6)    │
│  /recommend → recsys    │   │  tools: search_menu,        │
│  (ONNX Runtime)         │◄──┤   add_to_cart, get_cart,    │
└─────────────────────────┘   │   recommend, confirm_order  │
                              └──────────┬──────────────────┘
                                         ▼
                        Postgres (menu · cart · orders)
                        LLM: Qwen2.5-3B QLoRA via Ollama
                             ‖ hosted API (fallback)
```

### Why landmarks instead of video

Streaming webcam frames to a server is the reason most sign-language demos feel sluggish. Sending
only MediaPipe landmarks — 543 (x,y,z) points, a few KB per frame — cuts bandwidth by ~1000× and
keeps the round trip under 100ms. It also gives the project a real privacy property worth stating in
the thesis: **no camera imagery is ever transmitted or stored.** And it means the training data
(Google ISLR ships as pre-extracted landmarks) is in exactly the same format as runtime input, so
there is no train/serve skew.

### Why the LLM is not trained on the menu

The menu lives in Postgres and is reached through tool calls. A language model that generates prices
will eventually invent one, and a kiosk that quotes a wrong price is worse than no kiosk. The LLM
handles conversation, disambiguation, and — importantly — **ASL gloss reordering**: recognized signs
arrive as `WANT / BURGER / TWO / NO / ONION`, which is not English word order. Mapping that to
`{action: add, item: burger, qty: 2, mods: [-onion]}` is exactly what an LLM is good at, and it is a
genuine, defensible use of generative AI rather than decoration.

---

## The three models we train

### 1. ASL sign classifier — the centerpiece

- **Data:** Google Isolated Sign Language Recognition (~100k landmark sequences, 250 signs, 21 Deaf
  signers) + ~30 self-recorded ordering signs (BURGER, FRIES, COMBO, LARGE, SMALL, COMBO, CARD, CASH…).
  Record with the *same* MediaPipe pipeline the kiosk uses — 4 team members × ~20 takes × 30 signs
  ≈ 2,400 new sequences, which also gives the project an original dataset contribution.
- **Preprocessing:** keep both hands (42 pts), lips (~40 pts), upper-body pose (~10 pts) — drop the
  other ~450 face landmarks. Resample to T=32 frames. Normalize per frame: center on chest, scale by
  shoulder width.
- **Architecture:** depthwise-separable Conv1D stem → 4-layer Transformer encoder (d=256, 4 heads) →
  masked mean-pool → linear classifier over ~280 classes. ~5–8M params, trains in 2–4h on a free T4.
- **Augmentation:** horizontal flip, time warp, random affine, frame dropout.
- **Target:** ≥80% top-1 on held-out signers (signer-independent split — do not split randomly, or
  you will report an inflated number).
- **Export:** ONNX, served via ONNX Runtime in FastAPI.

**The hard part is segmentation, not classification.** The classifier labels a clip; a real user signs
a continuous stream. Handle it with a sliding window over the last 32 frames, a motion-energy gate on
landmark velocity to skip idle hands, a confidence threshold, and debouncing so one sign isn't emitted
three times. Budget real time for this — it is the most likely thing to make a working model feel broken.

### 2. Order recommender — produces the "specials" and upsells

- **Model:** item-to-item co-occurrence baseline, then a GRU4Rec-style next-item model over cart state.
  Metrics: Recall@k and MRR against the baseline.
- **Data honesty (read this):** there is no large public *fast-food transaction* dataset. The plan is to
  validate the modeling approach on a real public dataset (Instacart / Retail Transactions), then train
  the deployed recommender on a synthetic fast-food order log generated from realistic co-occurrence
  priors over our actual menu. This is defensible **only if stated plainly** in the report — write it
  as a limitation, don't paper over it.
- **Menu seed:** Kaggle "Restaurant Menu Items" (~5k real DoorDash items with real prices) to seed a
  plausible ~60-item menu.

### 3. QLoRA fine-tuned conversational LLM

- **Base:** Qwen2.5-3B-Instruct (Apache 2.0 — cleanest license for a published thesis; Llama 3.2 3B is
  the alternative). 4-bit QLoRA, seq len 1024, batch 1 + grad accum fits comfortably in a 16GB T4.
- **Training data:** synthetic ordering dialogues we generate — gloss-sequence inputs paired with
  correct tool-call outputs, covering ordering, modification, removal, disambiguation, and confirmation.
- **Serving — the constraint that matters:** you **cannot** serve a model from free Colab during a live
  demo; sessions time out and you cannot bet a presentation on one. Instead: train on Colab → merge the
  adapter → export GGUF → run locally under **Ollama**. A 3B model at Q4_K_M is ~2GB and runs at usable
  speed on a laptop, so the demo is genuinely self-contained with no external API.
- **Design for it:** put the LLM behind a provider interface with two backends (local Ollama, hosted
  API). This keeps the demo safe if the local model underperforms, and gives the thesis a real
  comparison chapter: fine-tuned-3B vs. hosted-frontier on tool-call accuracy and latency.

---

## Accessibility design

**Principle: no "select your disability" screen.** When a person is detected, the kiosk greets them in
*every* modality simultaneously — speaks the greeting, captions it in large type, and shows the menu —
then adapts to whichever channel the person actually uses. Making someone declare a disability to a
machine before it will serve them is slow, and it is the wrong thing to build.

| User | Input | Output |
|---|---|---|
| Deaf / hard of hearing | ASL, touch | Large captions, visual cart |
| Blind / low vision | Speech, keyboard | TTS, ARIA live regions, screen-reader flow |
| Speech-impaired | ASL, touch/text | TTS + text |
| Motor impairment | Speech | Speech + text, large targets |
| No disability | Speech or touch | Speech + text |

**Presence trigger:** MediaPipe Face Detector in-browser. Fire the greeting when a face is present for
>1.5s and the bounding box exceeds a size threshold (proxy for "at the counter, not walking past").
Reset after 5s of absence. Debounce so one person isn't greeted repeatedly.

**Compliance target:** WCAG 2.1 AA — contrast, 44px touch targets, full keyboard nav, ARIA live regions
for every state change. Cite the DOJ self-service kiosk accessibility rules for framing in the report.

---

## Repository layout

```
apps/kiosk/            Next.js 15 + TS + Tailwind + AI SDK v6
  app/api/agent/       streaming agent route, tool definitions
  components/          camera, captions, cart, menu
  lib/mediapipe/       landmark capture + presence detection
services/ml/           FastAPI: /ws/sign, /recommend, health
ml/
  asl/                 data prep · model · train · eval · export_onnx
  recsys/              data prep · train · eval
  llm/                 dialogue synthesis · qlora_train · merge · export_gguf
  collect/             self-recording tool for the 30 custom signs
notebooks/             Colab training notebooks
docs/                  spec, ADRs, thesis figures
data/                  gitignored; download scripts only
```

Work on a feature branch off `main`, PR in. Do not commit datasets or weights — download/export scripts only.

---

## Milestones

**M0 — Walking skeleton (do this first, before training anything).**
Browser captures landmarks → WebSocket → FastAPI returns a *hardcoded* sign → agent route → tool call →
TTS speaks it. Proves the full loop and its latency budget while the models are still stubs. If this
loop is slow, no amount of model accuracy will save the demo.

**M1 — Menu + agent.** Postgres schema, seed from the Kaggle menu dataset, tool-calling agent on a
hosted LLM, working touch + speech ordering. This is already a demoable product.

**M2 — ASL model.** Data prep, train on Google ISLR, signer-independent eval, ONNX export, wire into
`/ws/sign`. Then sliding-window segmentation and debouncing.

**M3 — Custom signs.** Build the recording tool, collect ~2,400 sequences across the team, retrain on
the union, re-evaluate.

**M4 — Recommender.** Train, evaluate against baseline, expose as the `get_recommendations` tool
driving the greeting's specials.

**M5 — QLoRA LLM.** Synthesize dialogues, fine-tune, merge, GGUF export, serve via Ollama, benchmark
against the hosted baseline on tool-call accuracy and latency.

**M6 — Accessibility audit + polish.** WCAG pass, keyboard nav, screen-reader run-through, latency
tuning, demo script.

---

## Verification

- **Latency budget, measured end to end** (instrument each hop): landmark capture → sign prediction
  <100ms; agent first token <500ms; full spoken response <1.5s. Log per-hop timings to the console
  from M0 onward so regressions are visible immediately.
- **ASL model:** signer-independent held-out split, top-1 and top-5 accuracy, confusion matrix. Confirm
  the split is by *signer*, not random — verify by asserting no signer ID appears in both splits.
- **Recommender:** Recall@5 and MRR vs. the co-occurrence baseline on a temporal split.
- **Agent correctness:** a fixture suite of ~40 ordering scenarios (add, modify, remove, ambiguous item,
  invalid item, mid-order change of mind) asserting the resulting cart JSON. Run against both LLM
  backends — this is also the fine-tuned-vs-hosted benchmark.
- **Price integrity test:** assert every price the agent utters matches the database. This is the one
  test that must never fail.
- **Accessibility:** axe-core in CI, plus a manual keyboard-only and screen-reader (NVDA) pass.
- **Live smoke test:** walk into frame, get greeted, order a combo in ASL, modify it, confirm — on a
  laptop webcam, end to end.

---

## Open items for the team

1. Confirm push access for `rl4658` on the repo.
2. Repo rename — needs Jeremy (admin).
3. **Role clarification:** the current presentation assigns people to two different workstreams. Confirm
   who owns which milestone here so two people aren't building the same thing.
4. Ask the advisor about SJSU HPC access — he raised GPU usage specifically, and a T4 caps the LoRA work.
5. The abstract and slides describe a second workstream. If the project is now ASL-only, those documents
   need updating before the next advisor review.
