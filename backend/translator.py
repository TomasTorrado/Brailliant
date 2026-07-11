# translator.py
#
# Converts plain text into Unified English Braille (UEB) grade-1 dot patterns.
#
# Pipeline:
#   1. Lowercase the text.
#   2. Expand digits into their spelled-out words ("1" -> "one").
#   3. Map every character to a 6-bit dot pattern using a hardcoded dictionary.
#
# A Braille cell has 6 dots laid out as:
#   1 4
#   2 5
#   3 6
#
# We pack each cell into one byte: bit0=dot1, bit1=dot2, bit2=dot3,
# bit3=dot4, bit4=dot5, bit5=dot6. This is the exact byte format sent over
# serial to the ESP32, which reads bits 0-5 straight into its 6 solenoid pins.

# Spoken words for digits 0-9, used to expand numbers before translation
# since Braille dot patterns are only defined for letters here.
DIGIT_WORDS = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}

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


def expand_digits(text):
    """Replace each digit character with its spelled-out word (e.g. '1' -> 'one')."""
    return "".join(DIGIT_WORDS.get(ch, ch) for ch in text)


def translate(text):
    """
    Translate a string into UEB Braille dot patterns.

    Returns a `bytes` object where each element is the 6-bit dot pattern
    (0-63) for the corresponding character in the lowercased, digit-expanded
    text. Characters with no Braille mapping (punctuation, symbols) are
    dropped for this MVP.
    """
    text = expand_digits(text.lower())
    patterns = [BRAILLE_MAP[ch] for ch in text if ch in BRAILLE_MAP]
    return bytes(patterns)


def translate_to_words(text):
    """
    Split text into words and translate each one independently, keeping the
    word boundaries intact. This is what the WebSocket streaming in main.py
    uses so it can step forward/backward one letter at a time and highlight
    the active letter in sync with the dot patterns.

    Returns a list of dicts: {"word": <display string>, "patterns": [int, ...]}
    """
    words = text.split()
    result = []
    for raw_word in words:
        expanded = expand_digits(raw_word.lower())
        # Keep only characters that have a Braille mapping so "word" and
        # "patterns" stay the same length and index-aligned for the frontend.
        display_word = "".join(ch for ch in expanded if ch in BRAILLE_MAP)
        patterns = list(translate(raw_word))
        if patterns:
            result.append({"word": display_word, "patterns": patterns})
    return result
