# Navigation Model

## Why letter-by-letter, not word-by-word

The physical display is a single 6-pin Braille cell — it can only ever
show one letter at a time. There's no auto-advancing timer; every step
forward or backward is a deliberate `next`/`back` command (from the
on-screen buttons, the left/right arrow keys, or the ESP32's physical
buttons).

## `ReaderState` (`backend/main.py`)

Position is `(word_index, letter_index)`, where `letter_index` runs from
`0` to `len(word)` **inclusive**:

- `0 .. len(word) - 1` select a specific letter in the current word.
- `letter_index == len(word)` is a distinct **word-end step** — a blank
  cell — that sits between one word and the next.

```python
def current_step(self):
    if not self.words:
        return {"type": "empty"}
    if self.at_end:
        return {"type": "document_end"}

    entry = self.words[self.word_index]
    word = entry["word"]

    if self.letter_index >= len(word):
        return {"type": "word_end", "word": word}

    return {"type": "letter", "word": word, ...}
```

`advance()` and `back()` are exact mirrors of each other:

```python
def advance(self):
    if self.at_end:
        return                              # no-op once the document has ended
    if self.letter_index < word_len:
        self.letter_index += 1              # next letter, or into word_end
    elif self.word_index == len(self.words) - 1:
        self.at_end = True                  # word_index/letter_index stay put
    else:
        self.word_index += 1
        self.letter_index = 0               # first letter of next word

def back(self):
    if self.at_end:
        self.at_end = False                 # undo — position was never moved
        return
    if self.letter_index > 0:
        self.letter_index -= 1              # previous letter, or out of word_end
    else:
        self.word_index = (self.word_index - 1) % len(self.words)
        self.letter_index = len(self.words[self.word_index]["word"])  # word_end of previous word
```

Going backward past the very first letter still wraps around to the last
word's word-end step (Python's `%` handles the negative wraparound) — only
the forward direction stops at the end, rather than wrapping. There's no
"beginning of document" stop yet, just the "end of document" one described
below.

## Worked example — `"hi bat"`

Starting at the very first letter and pressing `next` repeatedly:

| step | word_index | letter_index | `current_step()` |
|------|-----------|---------------|-------------------|
| 0 (initial) | 0 (`hi`) | 0 | `letter`, char `h` |
| 1 | 0 | 1 | `letter`, char `i` |
| 2 | 0 | 2 (`== len("hi")`) | `word_end`, word `hi` |
| 3 | 1 (`bat`) | 0 | `letter`, char `b` |
| 4 | 1 | 1 | `letter`, char `a` |
| 5 | 1 | 2 | `letter`, char `t` |
| 6 | 1 | 3 (`== len("bat")`) | `word_end`, word `bat` |
| 7 | 1 | 3 (unchanged, `at_end = True`) | `document_end` |
| 7 again | 1 | 3 (unchanged) | `document_end` (further `next` is a no-op) |

Pressing `back` from any row above produces the exact previous row —
verified live against the running backend, including `next` past the end
landing on `document_end` (not wrapping to `hi`), a repeated `next` there
staying a no-op, and `back`/`back` correctly reversing through
`document_end` → `word_end bat` → `letter t`.

## End of document

Reaching `document_end` sends `serial_link.send_byte(0)` (all pins down)
and `{"type": "document_end"}` over the WebSocket — the frontend shows a
distinct "End of Document" message in place of the word/cell display.
`next` is a no-op from here (`advance()` returns immediately); `back()`
just clears `at_end` without touching `word_index`/`letter_index`, since
they were never moved when `at_end` was set — so it lands squarely back on
the last word's `word_end` step, exactly the step directly before
`document_end` in the forward sequence.

## Empty document

Before anything is uploaded, `ReaderState.words` is empty and
`current_step()` returns `{"type": "empty"}` regardless of position —
`advance()`/`back()` are no-ops in this state. This is distinct from
`document_end`: `empty` means nothing has been loaded yet; `document_end`
means a real document was loaded and fully read through.
