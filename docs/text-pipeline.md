# Text Pipeline

How raw input becomes the byte patterns sent to the hardware and frontend.
Three stages, each in its own file, each independently testable:

```
raw bytes/text  ──▶  extract_*()  ──▶  clean_text()  ──▶  translate_to_words()  ──▶  ReaderState
(PDF, OCR, ...)      text_prep.py      text_prep.py        translator.py
```

## 1. Extraction — `text_prep.py`

Turns a raw input source into plain text. Today there's one:

- `extract_pdf_text(pdf_bytes)` — opens the bytes with PyMuPDF (`fitz`) and
  joins every page's `get_text()` output with newlines.

This is the designated home for future input sources too — a camera or
screenshot OCR path would add its own `extract_image_text(image_bytes)`
here, alongside this one. Each source function only needs to answer "what
raw text did we get from this input," nothing about Braille or cleaning.

## 2. Cleaning — `text_prep.clean_text(text)`

Every extraction source produces messy text — PDF text has odd spacing,
OCR output has misreads and stray punctuation. `clean_text()` is the one
shared normalization step every source needs before translation, since
`translator.py` only knows how to handle lowercase letters and spaces:

1. **Numbers → words.** Every run of digits is spelled out via the
   `num2words` library: `"42"` → `"forty-two"`, `"2024"` → `"two thousand
   and twenty-four"`. (Comma-grouped numbers like `"1,000"` aren't
   special-cased — the comma splits the digit run first, so it becomes
   `"one"` + `"zero zero zero"`, not `"one thousand"`. Rare enough in
   typical prose to not matter for this MVP.)
2. **Lowercase everything.**
3. **Strip anything that isn't a letter or whitespace — by replacing it
   with a space, not deleting it.** This is deliberate: deleting would
   glue adjacent words together (`"don't"` → `"dont"`); replacing with a
   space keeps them separate (`"don't"` → `"don t"`). This also cleans up
   the hyphens/commas `num2words` just introduced in step 1.
4. **Collapse repeated whitespace** to a single space and trim the ends.

Example:
```
"don't stop, it's 2024!"
  → "don t stop it s two thousand and twenty four"
```

## 3. Translation — `translator.py`

`BRAILLE_DOTS` is the hardcoded UEB grade-1 alphabet: each letter maps to
a tuple of which of the 6 dots are raised. Layout (matches the physical
cell and the firmware's pin order):

```
1 4
2 5
3 6
```

`_dots_to_byte(dots)` packs that tuple into a single 6-bit integer:
`bit0 = dot1 ... bit5 = dot6`. This exact byte is what eventually gets
written to the ESP32 over serial (see [protocol.md](protocol.md)) — there's
no separate hardware-facing format, the Python `int` *is* the wire format.

`BRAILLE_MAP` precomputes this for every letter once at import time.

Two entry points, both call `clean_text()` internally first (so any raw
text from any source is always safe to pass in directly):

- **`translate(text)`** — flat `bytes` object, one byte per character
  including spaces (space's tuple is `()`, byte `0`, i.e. a blank cell).
  Used for a whole-text byte stream.
- **`translate_to_words(text)`** — splits into words *after* cleaning (so
  punctuation-turned-spaces correctly create word boundaries), returns
  `[{"word": "hi", "patterns": [19, 10]}, ...]`. This is what
  `main.py`'s `ReaderState` actually uses — one dict per word, with a
  parallel `patterns` array (one byte per letter, index-aligned with
  `word`).

Worked example — `"hi"`:

| letter | raised dots | byte | binary (bit0→bit5) |
|--------|-------------|------|---------------------|
| h      | 1, 2, 5     | 19   | `110010`             |
| i      | 2, 4        | 10   | `010100`             |

`translate_to_words("hi")` → `[{"word": "hi", "patterns": [19, 10]}]`.
