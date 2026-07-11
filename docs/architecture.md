# Architecture

Three independent components, each of which can be tested without the
other two:

```
┌─────────────┐   HTTP (upload, next, back)   ┌──────────────┐
│   frontend   │ ─────────────────────────────▶│              │
│ React + Vite │                                │   backend    │
│              │◀──────────────────────────────│  FastAPI     │
└─────────────┘   WebSocket (/ws, JSON steps)  │              │
                                                 │              │
                                                 │              │◀──── USB serial
                                                 └──────────────┘      (raw bytes)
                                                        │
                                                        ▼
                                                 ┌──────────────┐
                                                 │   firmware   │
                                                 │  ESP32 sketch │
                                                 │  6 solenoids  │
                                                 │  2 buttons    │
                                                 └──────────────┘
```

## backend/ (FastAPI)

The hub. Owns the document state, decides what "the current step" is, and
is the only component that talks to both the frontend and the hardware.

- `text_prep.py` — turns raw input (PDF bytes today) into clean text ready
  for translation. See [text-pipeline.md](text-pipeline.md).
- `translator.py` — turns clean text into Braille dot-pattern bytes, one
  per letter. See [text-pipeline.md](text-pipeline.md).
- `main.py` — FastAPI app: HTTP routes (`/upload`, `/next`, `/back`), the
  `/ws` WebSocket, and `ReaderState` (the letter-by-letter position state
  machine). See [navigation-model.md](navigation-model.md) and
  [protocol.md](protocol.md).
- `serial_comm.py` — the USB serial link to the ESP32. Fails gracefully
  (logs and continues) if no board is plugged in, so the rest of the app
  works without hardware.

## frontend/ (React + Vite + Tailwind)

Renders whatever step the backend sends, and sends `next`/`back` commands
back (on-screen buttons, left/right arrow keys). Never talks to the ESP32
directly — everything routes through the backend.

- `PDFUploader.jsx` — upload screen.
- `WordDisplay.jsx` — the current word, active letter highlighted.
- `BrailleCell.jsx` — draws the current + next Braille cell as raised/lowered dots, decoding the same byte the ESP32 receives.
- `App.jsx` — opens the WebSocket, updates state on incoming steps, wires the buttons/arrow keys to `POST /next` and `POST /back`.
- `electron/` — optional desktop wrapper (Electron main/preload process) around the same React app; adds a native file-picker dialog, otherwise identical behavior to the browser build.

## firmware/ (ESP32 Arduino sketch)

The only component that touches real hardware. Deliberately minimal — no
Braille knowledge lives here, it just:

1. Reads one byte over serial per incoming dot pattern and drives 6 GPIO
   pins (one per solenoid) from its bits.
2. Watches two buttons ("next"/"back") and reports a press back over the
   same serial connection as a single byte (`'N'` / `'B'`).

All the "what does this letter look like in Braille" and "which letter are
we on" logic lives in the backend — the firmware is just I/O.

## Why the backend is the hub, not the frontend

The ESP32 only has a USB serial connection (no WiFi/WebSocket client), and
a browser can't open a serial connection directly. So the backend is the
only thing that can reach both the frontend (WebSocket) and the hardware
(serial) — every step update flows backend → frontend and backend → ESP32
at the same time, from the same source of truth (`ReaderState`).
