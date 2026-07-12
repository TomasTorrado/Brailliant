# Brailliant

Brailliant turns printed and on-screen text into physical Braille you can
feel. Point a camera at a page, capture your screen, or drop in a PDF —
Brailliant extracts the text, translates it to Unified English Braille (UEB)
grade‑1 dot patterns, and drives a **physical 6‑solenoid Braille cell** over
USB serial to an ESP32, in sync with a desktop UI.

Because the hardware is a single Braille cell, reading is **manual and
letter‑by‑letter**: the app shows the current word with the active letter
highlighted and previews the Braille cell, while on‑screen buttons, the arrow
keys, or the ESP32's physical buttons step forward/backward one letter at a
time — for both the screen and the physical dots.

You don't need the hardware to try it. With no ESP32 connected, everything
still runs end to end — you just don't get the physical dots.

```
Brailliant/
├── firmware/   ESP32 Arduino sketch — drives the 6 solenoids over serial
├── backend/    FastAPI server — text extraction → Braille → serial + WebSocket
├── frontend/   React + Vite + Tailwind + Electron desktop app
└── docs/       How the whole pipeline actually works — start at docs/README.md
```

## Features

Brailliant has four modes, chosen from the landing page:

| Mode | Key | What it does |
|------|-----|--------------|
| **Camera** | `M` | Live camera preview with real‑time text tracking. macOS Vision detects where text sits in frame and shows an arrow (on screen **and** on the physical cell) pointing the user which way to move; once text is centred, in focus, and steady, it auto‑captures and OCRs the frame. |
| **Screenshot** | `S` | Captures the screen via `getDisplayMedia`, OCRs it with Tesseract.js, and reads whatever's on screen. |
| **PDF** | `X` | Upload a PDF; the backend extracts its text with PyMuPDF. |
| **Learn** | `L` | Step through the Braille alphabet A–Z. Each letter drives the physical cell so you can feel the dots — with an option to hide the on‑screen cell for self‑testing. |

Camera and Screenshot modes both feed extracted text into the **same reader
view** as PDF mode, so navigation and the physical output work identically no
matter where the text came from.

> **Camera OCR and live guidance are desktop‑only** — they use a native macOS
> Vision bridge (a compiled Swift helper) that only exists in the Electron
> app. Screenshot and PDF modes work in a plain browser too.

## How it fits together

```
 camera / screen / PDF
          │
          ▼
   text extraction ──────────────┐
   (Vision · Tesseract · PyMuPDF) │
          │                       │
          ▼                       │
   FastAPI backend                │  Camera mode also streams
   text → UEB dot bytes           │  a "move the camera" direction
          │                       │  to the cell (Camera Movement
   ┌──────┴───────┐               │  Standard)
   ▼              ▼               │
 WebSocket     USB serial ◄───────┘
 (frontend)    (ESP32 → 6 solenoids)
```

The backend holds one reader state machine. `/next` and `/back` (from the UI
buttons, arrow keys, or the ESP32) advance or rewind exactly one step; each
step is pushed to the frontend over the `/ws` WebSocket **and** written as a
dot‑pattern byte over serial to the ESP32, keeping screen and dots in lockstep.

See **[docs/](docs/README.md)** for the full picture — architecture, the
text‑to‑Braille pipeline, the navigation state machine, and the exact wire
protocol.

## Quick start

Run the backend and frontend; the ESP32 is optional.

```bash
# 1. Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # adjust serial port / baud if using hardware
uvicorn main:app --reload --port 8000

# 2. Frontend (in another terminal)
cd frontend
npm install
cp .env.example .env               # adjust backend URL if not on localhost:8000
npm run build:native               # macOS only: compile the Vision OCR helper
npm run dev                        # launches Vite + the Electron desktop app
```

Then open the app, pick a mode, and step through the text with the on‑screen
Next/Back buttons, the ←/→ arrow keys, or the ESP32's physical buttons.

---

## 1. Firmware (`firmware/`)

An ESP32 Arduino sketch that drives a single 6‑dot Braille cell. Six 12 V
push‑pull solenoids are the dots, switched by a ULN2803A Darlington array off
a 3S LiPo rail; the ESP32 is powered and programmed over USB.

- Listens on USB serial for one byte per character. Each byte is a 6‑bit dot
  pattern (bit 0 = dot 1 … bit 5 = dot 6); each bit drives one GPIO pin wired
  to a solenoid. Solenoids are **active‑low** — a set bit drives its pin LOW
  to raise the dot.

Dot numbering, matching everything else in the project:

```
dot 1  ●  ●  dot 4
dot 2  ●  ●  dot 5
dot 3  ●  ●  dot 6
```

**Setup:**
1. Open `firmware/esp32_braille.ino` in the Arduino IDE (or PlatformIO) with
   ESP32 board support installed. No dependencies beyond `Arduino.h`.
2. Edit the `DOT_PINS` and `SERIAL_BAUD_RATE` constants near the top to match
   your wiring and the backend's baud rate (default `115200`).
3. Select your ESP32 board + serial port, then upload.

> Arduino sketches have no build‑time env vars, so pin numbers and timing
> constants live in one `const`/`#define` block at the top of the file — the
> firmware equivalent of a `.env`.

**Hardware:** see **[firmware/BOM.md](firmware/BOM.md)** for the full bill of
materials, wiring notes, an interactive circuit diagram, and the 3D‑printed
enclosure parts.

## 2. Backend (`backend/`)

FastAPI server that turns text from any source into Braille and streams it to
both the ESP32 (serial) and the frontend (WebSocket) in sync.

- `text_prep.py` — extracts text (`extract_pdf_text` via PyMuPDF) and
  normalizes it: lowercases, spells out digits (`num2words`), strips anything
  that isn't a letter or space.
- `translator.py` — maps each letter to its hardcoded UEB grade‑1 dot pattern,
  packed into one byte in the exact format the firmware reads.
- `serial_comm.py` — sends dot‑pattern bytes to the ESP32 over
  [pyserial](https://pyserial.readthedocs.io/). Fails gracefully (logs and
  continues) if no board is connected, and relays the ESP32's echoed bytes
  back to the console for debugging.
- `main.py` — the FastAPI app and the reader state machine.

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/upload` | POST | PDF in → extract text, load reader, return word count. |
| `/upload-text` | POST | Already‑extracted text in (camera/screenshot OCR) → load reader. |
| `/next`, `/back` | POST | Step the reader forward/back one letter. |
| `/actuate/{letter}` | POST | Drive the cell for one letter (Learn mode). |
| `/guide/{direction}` | POST | Drive the cell with a "move the camera" arrow (Camera mode). |
| `/ws` | WS | Streams each reader step to the frontend. |

Runs at `http://localhost:8000`. With no ESP32 plugged in you'll see a
`No ESP32 on …` log line and the server keeps running normally — only the
physical solenoids are inactive.

**Environment variables** (`backend/.env.example`, all optional):

| Variable | Default | Meaning |
|----------|---------|---------|
| `BRAILLE_SERIAL_PORT` | `/dev/cu.usbserial-0001` | Serial port the ESP32 is on |
| `BRAILLE_BAUD_RATE` | `115200` | Must match the firmware's baud rate |

## 3. Frontend (`frontend/`)

React 19 + Vite + Tailwind, packaged as an **Electron desktop app**. The
desktop build is what unlocks the native macOS Vision OCR bridge used by
Camera mode.

Key pieces:
- `LandingPage.jsx` — pick a mode (Camera / Screenshot / PDF / Learn).
- `CameraMode.jsx` — live preview, Vision‑based text tracking + auto‑capture,
  and the on‑screen half of the camera‑guidance arrows.
- `ScreenshotMode.jsx` — screen capture + Tesseract.js OCR.
- `PDFUploader.jsx` — drag‑and‑drop / click‑to‑select PDF upload.
- `LearnMode.jsx` — A–Z Braille trainer.
- `WordDisplay.jsx` / `BrailleCell.jsx` — the reader view: current word with
  active letter, rendered as raised/lowered dots.
- `App.jsx` — routing plus the `/ws` WebSocket wiring that keeps the UI in
  sync with the reader state.
- `electron/native/ocr_helper.swift` — the compiled Swift helper that bridges
  to macOS Vision for camera OCR.

**Scripts:**

| Command | Does |
|---------|------|
| `npm run dev` | Vite + Electron desktop app (full experience). |
| `npm run dev:web` | Vite only, plain browser (no camera OCR / guidance). |
| `npm run build:native` | Compile the macOS Vision OCR helper (macOS only). |
| `npm run build` | Production Electron build for mac/win/linux. |
| `npm run lint` | Lint with oxlint. |

**Environment variables** (`frontend/.env.example`):

| Variable | Default | Meaning |
|----------|---------|---------|
| `VITE_BACKEND_URL` | `http://localhost:8000` | Backend HTTP base URL |
| `VITE_BACKEND_WS_URL` | `ws://localhost:8000/ws` | Backend WebSocket URL |

## Running the full stack with hardware

1. Flash the ESP32 with `firmware/esp32_braille.ino` (optional — everything
   works without it, just without solenoids/buttons).
2. Start the backend: `uvicorn main:app --reload --port 8000`.
3. Start the frontend: `npm run dev`.
4. Open the app, pick a mode, and read: step with the on‑screen Next/Back
   buttons, the ←/→ arrow keys, or the ESP32's physical buttons — shown on
   screen and, if connected, embossed on the physical cell.
