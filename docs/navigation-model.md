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

    entry = self.words[self.word_index % len(self.words)]
    word = entry["word"]

    if self.letter_index >= len(word):
        return {"type": "word_end", "word": word}

    return {"type": "letter", "word": word, ...}
```

`advance()` and `back()` are exact mirrors of each other:

```python
def advance(self):
    if self.letter_index < word_len:
        self.letter_index += 1              # next letter, or into word_end
    else:
        self.word_index = (self.word_index + 1) % len(self.words)
        self.letter_index = 0               # first letter of next word

def back(self):
    if self.letter_index > 0:
        self.letter_index -= 1              # previous letter, or out of word_end
    else:
        self.word_index = (self.word_index - 1) % len(self.words)
        self.letter_index = len(self.words[self.word_index]["word"])  # word_end of previous word
```

Both wrap around the document (Python's `%` handles negative wraparound
too, so `back()` from the very first letter lands on the last word's
word-end step).

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
| 7 | 0 (wrapped) | 0 | `letter`, char `h` |

Pressing `back` from any row above produces the exact previous row — this
was verified live against the running backend (`next`/`next`/`back`/`back`
reproduces the same sequence in reverse).

## Empty document

Before anything is uploaded, `ReaderState.words` is empty and
`current_step()` returns `{"type": "empty"}` regardless of position —
`advance()`/`back()` are no-ops in this state.
