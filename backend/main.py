# main.py
#
# FastAPI backend for the Braille reader MVP.
#
# Flow:
#   1. Client POSTs a PDF to /upload (extracted server-side with PyMuPDF) or
#      already-extracted text to /upload-text (e.g. from camera OCR run
#      client-side) — either way we translate it into a list of words, each
#      with its Braille dot patterns (see translator.py).
#   2. Client opens a WebSocket at /ws. Since the hardware is a single
#      6-pin Braille cell, only one letter can ever be displayed at a time
#      — so reading is fully manual, letter by letter: every "next"/"back"
#      command (from the web UI's buttons/arrow keys) advances or rewinds
#      exactly one step. Finishing a word's last letter takes one extra
#      "next" into a distinct word-end (blank cell) step before the next
#      word's first letter appears; "back" mirrors this exactly. Stepping
#      past the very last word's word-end step lands on a document-end
#      step (all pins down) instead of wrapping back to the start; "next"
#      is then a no-op until "back" undoes it.
#   3. Next/back navigation comes only from the web UI (its buttons/arrow
#      keys POST to /next and /back) — the ESP32 just drives solenoids and
#      echoes every byte it receives back over serial, which a background
#      task relays to our console for debugging.

import asyncio
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env before importing serial_comm, which reads
# BRAILLE_SERIAL_PORT / BRAILLE_BAUD_RATE from the environment at import time.
# Running `uvicorn main:app` does NOT auto-load .env, so we do it explicitly.
load_dotenv(Path(__file__).with_name(".env"))

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from serial_comm import SerialLink  # noqa: E402
from text_prep import extract_pdf_text  # noqa: E402
from translator import translate_to_words  # noqa: E402

app = FastAPI()

# Wide-open CORS since this is a same-machine hackathon demo (frontend on a
# different dev-server port needs to reach the backend).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

serial_link = SerialLink()


class TextPayload(BaseModel):
    text: str


class ReaderState:
    """
    Holds the current document's words and the current playback position.

    Position is (word_index, letter_index), where letter_index runs from 0
    to len(word) inclusive: 0..len(word)-1 select a letter, and
    letter_index == len(word) is the word-end step (blank cell) between one
    word and the next.
    """

    def __init__(self):
        self.words = []  # list of {"word": str, "patterns": [int, ...]}
        self.word_index = 0
        self.letter_index = 0
        self.at_end = False

    def load(self, text):
        self.words = translate_to_words(text)
        self.word_index = 0
        self.letter_index = 0
        self.at_end = False

    def current_step(self):
        if not self.words:
            return {"type": "empty"}
        if self.at_end:
            return {"type": "document_end"}

        entry = self.words[self.word_index]
        word = entry["word"]

        if self.letter_index >= len(word):
            return {"type": "word_end", "word": word}

        return {
            "type": "letter",
            "word": word,
            "patterns": entry["patterns"],
            "index": self.letter_index,
            "pattern": entry["patterns"][self.letter_index],
        }

    def advance(self):
        """Move forward exactly one letter (or into/out of the word-end step)."""
        if not self.words or self.at_end:
            return
        word_len = len(self.words[self.word_index]["word"])
        if self.letter_index < word_len:
            self.letter_index += 1
        elif self.word_index == len(self.words) - 1:
            # Stepping past the last word's word-end step ends the document,
            # rather than wrapping back to the first word. word_index/
            # letter_index are left exactly as-is (still the last word's
            # word-end step) so back() can just clear at_end to undo this.
            self.at_end = True
        else:
            self.word_index += 1
            self.letter_index = 0

    def back(self):
        """Move backward exactly one letter (mirrors advance())."""
        if not self.words:
            return
        if self.at_end:
            self.at_end = False
            return
        if self.letter_index > 0:
            self.letter_index -= 1
        else:
            self.word_index = (self.word_index - 1) % len(self.words)
            self.letter_index = len(self.words[self.word_index]["word"])


state = ReaderState()

# Each connected frontend gets its own control queue (keyed by connection
# id) so next/back events always reach the live WebSocket loop. Without
# this, a stale connection (e.g. from a page refresh) could sit forever
# awaiting a shared queue and steal the event meant for the new one.
connection_queues = {}


async def broadcast_control(command):
    """Fan a next/back event out to every currently-connected frontend."""
    for queue in list(connection_queues.values()):
        await queue.put(command)


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Accept a PDF, extract its text, and load it for reading."""
    pdf_bytes = await file.read()
    text = extract_pdf_text(pdf_bytes)

    state.load(text)
    return {"word_count": len(state.words)}


@app.post("/upload-text")
async def upload_text(payload: TextPayload):
    """Accept already-extracted text (e.g. camera OCR) and load it for reading."""
    state.load(payload.text)
    return {"word_count": len(state.words)}


@app.post("/next")
async def next_step():
    """Advance one letter. Called by the frontend's Next button/arrow key."""
    await broadcast_control("next")
    return {"ok": True}


@app.post("/back")
async def back_step():
    """Rewind one letter. Called by the frontend's Back button/arrow key."""
    await broadcast_control("back")
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    """Streams the current letter step, then waits for next/back commands."""
    await websocket.accept()
    my_queue = asyncio.Queue()
    connection_queues[id(websocket)] = my_queue
    try:
        await send_current_step(websocket)
        while True:
            command = await my_queue.get()
            if command == "next":
                state.advance()
            elif command == "back":
                state.back()
            await send_current_step(websocket)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        connection_queues.pop(id(websocket), None)


async def send_current_step(websocket):
    """Send the current step to the frontend and drive the physical solenoids."""
    step = state.current_step()

    if step["type"] == "empty":
        serial_link.send_byte(0)
        await websocket.send_json({"type": "empty"})
        return

    if step["type"] == "document_end":
        serial_link.send_byte(0)  # all pins down
        await websocket.send_json({"type": "document_end"})
        return

    if step["type"] == "word_end":
        serial_link.send_byte(0)  # blank cell between words
        await websocket.send_json({"type": "word_end", "word": step["word"]})
        return

    serial_link.send_byte(step["pattern"])
    await websocket.send_json(
        {
            "type": "letter",
            "word": step["word"],
            "patterns": step["patterns"],
            "index": step["index"],
        }
    )


async def poll_serial_debug():
    """Background task: relay the ESP32's serial debug output to our console.

    The ESP32 echoes every byte it receives (see firmware handleIncomingSerial),
    so this prints the board's view of the data right next to the "sent byte"
    logs — useful because the USB port can only be held by one program, so the
    Arduino Serial Monitor can't be open at the same time as this backend.
    """
    buffer = b""
    while True:
        data = serial_link.read_available()
        if data:
            buffer += data
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                text = line.decode(errors="replace").rstrip("\r")
                if text:
                    print(f"[esp32] {text}")
        await asyncio.sleep(0.05)


@app.on_event("startup")
async def on_startup():
    asyncio.create_task(poll_serial_debug())
