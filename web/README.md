# SignOrder terminal

Next.js front end and ordering agent. See [../../docs/development.md](../../docs/development.md)
to run it, and [../../docs/spec.md](../../docs/spec.md) for the design.

```
app/api/agent    streaming tool-calling agent
lib/agent        cart logic (LLM-free) + tools + prompt + model backends
lib/db           Drizzle schema over PGlite
lib/mediapipe    landmark capture, presence detection
lib/sign         WebSocket client for the recognition service
lib/terminal        speech, gloss buffering
components       ordering UI
```
