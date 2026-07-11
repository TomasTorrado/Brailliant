# Documentation

How this project actually works end to end, beyond what the top-level
[README.md](../README.md) covers for setup/running.

- [architecture.md](architecture.md) — the three components and how they talk to each other.
- [text-pipeline.md](text-pipeline.md) — how a raw PDF (or future camera/screenshot input) becomes Braille dot patterns.
- [navigation-model.md](navigation-model.md) — why reading is letter-by-letter with manual next/back, and the state machine behind it.
- [protocol.md](protocol.md) — the exact bytes/JSON sent over serial and WebSocket, and how they stay in sync.

Read them in that order if you're new to the codebase; each one assumes
the previous.
