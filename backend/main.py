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
#      command (from the web UI or the ESP32's physical buttons) advances
#      or rewinds exactly one step. Finishing a word's last letter takes
#      one extra "next" into a distinct word-end (blank cell) step before
#      the next word's first letter appears; "back" mirrors this exactly.
#   3. The ESP32's physical "next"/"back" buttons report back over the same
#      serial connection ('N' / 'B' bytes). A background task polls for
#      those and broadcasts them the same way the HTTP /next and /back
#      endpoints do, so the button and the web UI control the same reading
#      session.

import asyncio

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from serial_comm import SerialLink
from text_prep import extract_pdf_text
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

    def load(self, text):
        self.words = translate_to_words(text)
        self.word_index = 0
        self.letter_index = 0

    def current_step(self):
        if not self.words:
            return {"type": "empty"}

        entry = self.words[self.word_index % len(self.words)]
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
        if not self.words:
            return
        word_len = len(self.words[self.word_index % len(self.words)]["word"])
        if self.letter_index < word_len:
            self.letter_index += 1
        else:
            self.word_index = (self.word_index + 1) % len(self.words)
            self.letter_index = 0

    def back(self):
        """Move backward exactly one letter (mirrors advance())."""
        if not self.words:
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
    """Advance one letter. Called by the frontend or the ESP32 'next' button."""
    await broadcast_control("next")
    return {"ok": True}


@app.post("/back")
async def back_step():
    """Rewind one letter. Called by the frontend or the ESP32 'back' button."""
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


async def poll_serial_buttons():
    """Background task: watch for 'N'/'B' button-event bytes sent back by the ESP32."""
    while True:
        event = serial_link.read_button_event()
        if event == b"N":
            await broadcast_control("next")
        elif event == b"B":
            await broadcast_control("back")
        await asyncio.sleep(0.05)


@app.on_event("startup")
async def on_startup():
    asyncio.create_task(poll_serial_buttons())
