# main.py
#
# FastAPI backend for the Braille reader MVP.
#
# Flow:
#   1. Client POSTs a PDF to /upload. We extract its text with PyMuPDF and
#      translate it into a list of words, each with its Braille dot
#      patterns (see translator.py).
#   2. Client opens a WebSocket at /ws. We stream the current word's
#      characters one at a time: each character's dot pattern is written
#      out over serial to the ESP32 (raising the solenoids) AND sent to the
#      frontend (to render the BrailleCell + speak the letter), so hardware
#      and UI stay in sync.
#   3. The ESP32's physical "next"/"repeat" buttons report back over the
#      same serial connection ('N' / 'R' bytes). A background task polls
#      for those and broadcasts them the same way the HTTP /next and
#      /repeat endpoints do, so the button and the web UI control the same
#      reading session.

import asyncio
import os

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import fitz  # PyMuPDF

from serial_comm import SerialLink
from translator import translate_to_words

app = FastAPI()

# Wide-open CORS since this is a same-machine hackathon demo (frontend on a
# different dev-server port needs to reach the backend).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# How long to pause between characters / words while streaming, so the
# solenoids, the frontend highlight, and the speech readout stay readable
# and in sync. Overridable via environment variables.
CHAR_DELAY = float(os.environ.get("BRAILLE_CHAR_DELAY", "0.4"))
WORD_DELAY = float(os.environ.get("BRAILLE_WORD_DELAY", "0.6"))

serial_link = SerialLink()


class ReaderState:
    """Holds the current document's words and the current playback position."""

    def __init__(self):
        self.words = []  # list of {"word": str, "patterns": [int, ...]}
        self.index = 0

    def load(self, text):
        self.words = translate_to_words(text)
        self.index = 0

    def current(self):
        if not self.words:
            return None
        return self.words[self.index % len(self.words)]

    def advance(self):
        if self.words:
            self.index = (self.index + 1) % len(self.words)


state = ReaderState()

# Each connected frontend gets its own control queue (keyed by connection
# id) so next/repeat events always reach the live WebSocket loop. Without
# this, a stale connection (e.g. from a page refresh) could sit forever
# awaiting a shared queue and steal the event meant for the new one.
connection_queues = {}


async def broadcast_control(command):
    """Fan a next/repeat event out to every currently-connected frontend."""
    for queue in list(connection_queues.values()):
        await queue.put(command)


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Accept a PDF, extract its text with PyMuPDF, and load it for reading."""
    pdf_bytes = await file.read()
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = "\n".join(page.get_text() for page in doc)
    doc.close()

    state.load(text)
    return {"word_count": len(state.words)}


@app.post("/next")
async def next_word():
    """Advance to the next word. Called by the frontend or the ESP32 'next' button."""
    await broadcast_control("next")
    return {"ok": True}


@app.post("/repeat")
async def repeat_word():
    """Re-send the current word. Called by the frontend or the ESP32 'repeat' button."""
    await broadcast_control("repeat")
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    """Streams the current word's characters, then waits for next/repeat commands."""
    await websocket.accept()
    my_queue = asyncio.Queue()
    connection_queues[id(websocket)] = my_queue
    try:
        await stream_current_word(websocket)
        while True:
            command = await my_queue.get()
            if command == "next":
                state.advance()
            # "repeat" just re-streams the current word without advancing.
            await stream_current_word(websocket)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        connection_queues.pop(id(websocket), None)


async def stream_current_word(websocket):
    """Send one word's characters, one at a time, to the frontend and the ESP32."""
    entry = state.current()
    if entry is None:
        await websocket.send_json({"type": "empty"})
        return

    # Include the full pattern list up front so the frontend can preview the
    # "next" Braille cell before its character event actually arrives.
    await websocket.send_json({"type": "word_start", "word": entry["word"], "patterns": entry["patterns"]})
    for ch, pattern in zip(entry["word"], entry["patterns"]):
        serial_link.send_byte(pattern)
        await websocket.send_json({"type": "char", "char": ch, "pattern": pattern})
        await asyncio.sleep(CHAR_DELAY)
    await websocket.send_json({"type": "word_end", "word": entry["word"]})
    await asyncio.sleep(WORD_DELAY)


async def poll_serial_buttons():
    """Background task: watch for 'N'/'R' button-event bytes sent back by the ESP32."""
    while True:
        event = serial_link.read_button_event()
        if event == b"N":
            await broadcast_control("next")
        elif event == b"R":
            await broadcast_control("repeat")
        await asyncio.sleep(0.05)


@app.on_event("startup")
async def on_startup():
    asyncio.create_task(poll_serial_buttons())
