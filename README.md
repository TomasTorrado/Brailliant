# Braille Reader 

Reads text from a PDF, translates it to Unified English Braille (UEB) dot
patterns, and drives a physical 6-solenoid Braille cell over USB serial to
an ESP32. A React frontend shows the current word (with the active letter
highlighted), previews the current + next Braille cell, and reads each word
aloud with the Web Speech API. Physical "next"/"repeat" buttons on the
ESP32 control playback for both the hardware and the web UI.

```
braille-project/
├── firmware/       ESP32 Arduino sketch — drives solenoids, reads buttons
├── backend/        FastAPI server — PDF -> text -> Braille -> serial/WebSocket
└── frontend/       React + Vite + Tailwind UI
```

Everything below can be run and tested independently — you don't need the
ESP32 hardware to see the frontend + backend working end to end.

## 1. Firmware (`firmware/`)

- Arduino sketch for an ESP32.
- Listens on USB serial for one byte per character. Each byte is a 6-bit
  dot pattern (bit 0 = dot 1 ... bit 5 = dot 6); each bit drives one GPIO
  pin wired to a solenoid.
- Listens on two button GPIO pins ("next" and "repeat"). On a press, sends
  a single byte back over serial (`'N'` or `'R'`) so the backend advances
  or repeats the current word.

**Setup:**
1. Open `firmware/esp32_braille.ino` in the Arduino IDE (or PlatformIO)
   with ESP32 board support installed.
2. Edit the `DOT_PINS`, `NEXT_BUTTON_PIN`, and `REPEAT_BUTTON_PIN` constants
   near the top of the file to match your wiring.
3. Select your ESP32 board + serial port, then upload.
4. The sketch has no dependencies beyond the standard `Arduino.h` framework.

> Arduino sketches don't support environment variables at build time, so
> the pin numbers and timing constants are grouped in one `#define`/`const`
> block at the top of the file instead — the firmware equivalent.

## 2. Backend (`backend/`)

FastAPI server that extracts text from an uploaded PDF, translates it to
Braille, and streams it to both the ESP32 (serial) and the frontend
(WebSocket) in sync.

- `translator.py` — lowercases text, expands digits to words, and maps
  each letter to a hardcoded UEB dot pattern.
- `serial_comm.py` — sends dot-pattern bytes to the ESP32 over
  [pyserial](https://pyserial.readthedocs.io/). Fails gracefully (logs and
  continues) if no board is connected.
- `main.py` — FastAPI app: `/upload` (PDF in, word count out), `/ws`
  (streams word/character events), `/next` and `/repeat` (advance/replay,
  callable from the web UI or the ESP32 buttons).

**Setup:**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # adjust serial port / baud / timing if needed
uvicorn main:app --reload --port 8000
```

Runs at `http://localhost:8000`. If no ESP32 is plugged in, you'll see a
"No ESP32 on ..." log line and the server keeps running normally — only
the physical solenoids/buttons are inactive.

**Environment variables** (see `backend/.env.example`):

| Variable              | Default          | Meaning                              |
|------------------------|-------------------|---------------------------------------|
| `BRAILLE_SERIAL_PORT`  | `/dev/ttyUSB0`    | Serial port the ESP32 is on           |
| `BRAILLE_BAUD_RATE`    | `9600`            | Must match the firmware's baud rate   |
| `BRAILLE_CHAR_DELAY`   | `0.4` (seconds)   | Pause between streamed characters     |
| `BRAILLE_WORD_DELAY`   | `0.6` (seconds)   | Pause between streamed words          |

## 3. Frontend (`frontend/`)

React + Vite + Tailwind UI: upload a PDF, then watch/hear it read back
word by word.

- `PDFUploader.jsx` — drag-and-drop or click-to-select PDF upload screen.
- `WordDisplay.jsx` — shows the current word, highlighting the active letter.
- `BrailleCell.jsx` — renders the current and next Braille cell as filled
  (raised) / empty (lowered) dots.
- `App.jsx` — wires it together: opens the `/ws` WebSocket, advances state
  on incoming events, and speaks each word via `window.speechSynthesis`.

**Setup:**
```bash
cd frontend
npm install
cp .env.example .env             # adjust backend URL if not on localhost:8000
npm run dev
```

Open the printed local URL (defaults to `http://localhost:5173`). Make
sure the backend is running first so the WebSocket can connect.

**Environment variables** (see `frontend/.env.example`):

| Variable               | Default                      | Meaning                  |
|-------------------------|-------------------------------|--------------------------|
| `VITE_BACKEND_URL`      | `http://localhost:8000`       | Backend HTTP base URL    |
| `VITE_BACKEND_WS_URL`   | `ws://localhost:8000/ws`      | Backend WebSocket URL    |

## Running the full stack

1. Flash the ESP32 with `firmware/esp32_braille.ino` (optional — works
   without it, just without solenoids/buttons).
2. Start the backend (`uvicorn main:app --reload --port 8000`).
3. Start the frontend (`npm run dev`).
4. Open the frontend, upload a PDF, and it starts reading — word by word,
   spoken aloud, shown on screen, and (if connected) embossed on the
   physical display. Use the on-screen Next/Repeat buttons or the ESP32's
   physical buttons to move through the document.
