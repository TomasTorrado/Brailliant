# text_prep.py
#
# Shared entry point for turning raw input from any source (PDF extraction
# today; camera/screenshot OCR later) into text ready for translator.py,
# which only knows how to translate plain lowercase letters and spaces.
# Each source gets its own extract_*() function here; clean_text() is the
# normalization step every one of them needs afterward.

import re

import fitz  # PyMuPDF
from num2words import num2words

# Any run of digits, e.g. "2024" or "42".
_DIGIT_RUN = re.compile(r"\d+")

# Anything left over that isn't a lowercase letter or whitespace.
_NON_LETTER = re.compile(r"[^a-z\s]")

_WHITESPACE_RUN = re.compile(r"\s+")


def extract_pdf_text(pdf_bytes):
    """Extract raw text from PDF file bytes using PyMuPDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def clean_text(text):
    """
    Normalize raw text into something safe for Braille translation:

    1. Every run of digits becomes its spelled-out number (e.g. "42" ->
       "forty-two", "2024" -> "two thousand and twenty-four").
    2. Everything is lowercased.
    3. Any remaining character that isn't a letter or whitespace (including
       the hyphens/commas num2words just introduced) is replaced with a
       space rather than dropped, so punctuation/noise can't glue two
       separate words together.
    4. Repeated whitespace collapses to a single space.
    """
    text = _DIGIT_RUN.sub(lambda match: num2words(int(match.group())), text)
    text = text.lower()
    text = _NON_LETTER.sub(" ", text)
    return _WHITESPACE_RUN.sub(" ", text).strip()
