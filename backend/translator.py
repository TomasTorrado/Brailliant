# translator.py
#
# Converts text into Unified English Braille (UEB) grade-1 dot patterns.
# Expects text already normalized by text_prep.clean_text (lowercase,
# numbers spelled out, only letters/spaces left) — translate() and
# translate_to_words() both clean their input themselves, so any raw text
# from any source is safe to pass in directly.
#
# A Braille cell has 6 dots laid out as:
#   1 4
#   2 5
#   3 6
#
# We pack each cell into one byte: bit0=dot1, bit1=dot2, bit2=dot3,
# bit3=dot4, bit4=dot5, bit5=dot6. This is the exact byte format sent over
# serial to the ESP32, which reads bits 0-5 straight into its 6 solenoid pins.

from text_prep import clean_text

# Hardcoded UEB grade-1 alphabet: character -> tuple of raised dot numbers (1-6).
BRAILLE_DOTS = {
    "a": (1,),
    "b": (1, 2),
    "c": (1, 4),
    "d": (1, 4, 5),
    "e": (1, 5),
    "f": (1, 2, 4),
    "g": (1, 2, 4, 5),
    "h": (1, 2, 5),
    "i": (2, 4),
    "j": (2, 4, 5),
    "k": (1, 3),
    "l": (1, 2, 3),
    "m": (1, 3, 4),
    "n": (1, 3, 4, 5),
    "o": (1, 3, 5),
    "p": (1, 2, 3, 4),
    "q": (1, 2, 3, 4, 5),
    "r": (1, 2, 3, 5),
    "s": (2, 3, 4),
    "t": (2, 3, 4, 5),
    "u": (1, 3, 6),
    "v": (1, 2, 3, 6),
    "w": (2, 4, 5, 6),
    "x": (1, 3, 4, 6),
    "y": (1, 3, 4, 5, 6),
    "z": (1, 3, 5, 6),
    " ": (),  # space = no dots raised
}


def _dots_to_byte(dots):
    """Pack a tuple of dot numbers (1-6) into a 6-bit pattern byte."""
    pattern = 0
    for dot in dots:
        pattern |= 1 << (dot - 1)
    return pattern


# Precompute the full character -> byte-pattern map once at import time.
BRAILLE_MAP = {ch: _dots_to_byte(dots) for ch, dots in BRAILLE_DOTS.items()}


def translate(text):
    """
    Translate raw text into UEB Braille dot patterns.

    Returns a `bytes` object where each element is the 6-bit dot pattern
    (0-63) for the corresponding character after cleaning (see
    text_prep.clean_text): numbers spelled out, punctuation/noise replaced
    with spaces, everything lowercased.
    """
    cleaned = clean_text(text)
    return bytes(BRAILLE_MAP[ch] for ch in cleaned)


def translate_to_words(text):
    """
    Clean raw text, split it into words, and translate each one
    independently, keeping word boundaries intact. This is what the
    WebSocket streaming in main.py uses so it can step forward/backward one
    letter at a time and highlight the active letter in sync with the dot
    patterns.

    Returns a list of dicts: {"word": <display string>, "patterns": [int, ...]}
    """
    cleaned = clean_text(text)
    result = []
    for word in cleaned.split():
        patterns = [BRAILLE_MAP[ch] for ch in word]
        if patterns:
            result.append({"word": word, "patterns": patterns})
    return result
