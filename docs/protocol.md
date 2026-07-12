# Protocol

Every step update is driven from one function, `send_current_step()` in
`main.py`, which sends the *same* underlying data out over two different
channels at (as close as possible to) the same moment:

```python
async def send_current_step(websocket):
    step = state.current_step()
    ...
    serial_link.send_byte(step["pattern"])   # → ESP32, raw byte, USB serial
    await websocket.send_json({...})          # → frontend, JSON, WebSocket
```

There's no artificial delay between the two calls — that's what keeps the
physical pins and the on-screen dots showing the same letter at the same
time.

## HTTP routes (`main.py`)

| Route | Method | Body → Response | Purpose |
|-------|--------|------------------|---------|
| `/upload` | POST | multipart PDF file → `{"word_count": int}` | Extract + clean + translate a PDF, reset reading position to the start. |
| `/next` | POST | — → `{"ok": true}` | Broadcast a `next` command to every connected WebSocket. |
| `/back` | POST | — → `{"ok": true}` | Broadcast a `back` command to every connected WebSocket. |
| `/guide/{direction}` | POST | — → `{"direction", "pattern"}` | Camera Movement Standard: drive the cell to point the way to move the camera. Stateless (like `/actuate`), independent of `ReaderState`. |

`/next` and `/back` don't return the new step directly — they just signal
the `/ws` loop, which then pushes the updated step to every connected
client. The frontend's buttons/arrow keys call these; so does the ESP32
indirectly (see below).

### Camera Movement Standard (`/guide/{direction}`)

Camera Mode runs a live in-browser detection loop (a cheap gradient
centre-of-mass over a downscaled frame — no ML model, works offline in the
Electron build). It turns the detected object's offset from frame-centre
into one of eight directions — `up`, `down`, `left`, `right`, `up-left`,
`up-right`, `down-left`, `down-right` — or `centered`, and POSTs it here
only when it changes. The backend maps it to a 6-dot pattern that *points
the way to move the camera* (arrow points at the object): e.g. object high
and left → raise the top-left dot; `centered` raises all six as a distinct
"locked on" buzz. Steady centring auto-fires a capture, so a blind user can
aim by feel and let it read once framed. Same one-byte serial path as a
letter — the ESP32 needs no camera knowledge.

| Direction | Raised dots | Byte |
|-----------|-------------|------|
| `up` | 1,4 | 9 |
| `down` | 3,6 | 36 |
| `left` | 1,2,3 | 7 |
| `right` | 4,5,6 | 56 |
| `up-left` | 1 | 1 |
| `up-right` | 4 | 8 |
| `down-left` | 3 | 4 |
| `down-right` | 6 | 32 |
| `centered` | 1–6 (all) | 63 |

## WebSocket (`/ws`)

One JSON message per step, one of four shapes:

```jsonc
// A letter is active.
{
  "type": "letter",
  "word": "hi",           // the whole current word, for highlighting/display
  "patterns": [19, 10],   // every letter's byte in this word, index-aligned with word
  "index": 0              // which position in word/patterns is active right now
}

// Finished a word; blank cell before the next word's first letter.
{ "type": "word_end", "word": "hi" }

// Reached the end of the document (stepping past the last word's
// word_end) — "next" is a no-op from here until "back" undoes it.
{ "type": "document_end" }

// No document loaded yet.
{ "type": "empty" }
```

Deliberately **not** sent (removed as unused dead weight): a duplicate
single `pattern` byte or the active `char` — the frontend already
reconstructs both from `patterns[index]` and `word[index]`, so sending
them again would just be redundant bytes on the wire.

Frontend side (`App.jsx`): `patterns[index]` is the current letter's byte,
decoded bit-by-bit in `BrailleCell.jsx` (`pattern & (1 << bit)`) to draw
each of the 6 dots — the exact same decoding the ESP32 does on the
hardware side, just in JS instead of C++.

## Serial (backend ↔ ESP32, `serial_comm.py` ↔ `esp32_braille.ino`)

Two independent one-byte streams over the same USB connection:

**Backend → ESP32** (one raw byte per step):
- A letter step sends its packed dot-pattern byte (`0`–`63`, bit0=dot1 ...
  bit5=dot6).
- A `word_end`, `document_end`, or `empty` step sends `0` — no dots
  raised, blank cell / all pins down.

**ESP32 → backend** (one raw byte per button press):
- `'N'` — next button pressed.
- `'B'` — back button pressed.

`serial_comm.py`'s `poll_serial_buttons()` background task watches for
these and calls `broadcast_control("next"/"back")` — the exact same path
the HTTP `/next`/`/back` routes use — so a physical button press and a
web-UI click are indistinguishable to `ReaderState` once they arrive.

If no ESP32 is connected, `SerialLink` fails to open the port, logs it,
and every `send_byte`/`read_button_event` call becomes a silent no-op —
the WebSocket/frontend side keeps working normally.

**Must match on both ends:** `BRAILLE_BAUD_RATE` (backend `.env`) and
`SERIAL_BAUD_RATE` (firmware `.ino`). ⚠️ As of this writing the firmware
uses `115200` while `backend/.env(.example)` still default to `9600` —
double check these agree before wiring up real hardware, or serial reads
on both ends will be garbled.
