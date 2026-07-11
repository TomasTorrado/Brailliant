// braille.js
//
// Single source of truth on the frontend for the UEB grade-1 alphabet.
// Mirrors backend/translator.py:BRAILLE_DOTS. Each pattern is the same
// 6-bit byte the backend sends to the ESP32: bit0=dot1 ... bit5=dot6, so
// LETTER_PATTERNS[ch] can be passed straight to <BrailleCell currentPattern>.

export const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

// char -> list of raised dot numbers (1-6)
const DOTS = {
  a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5],
  f: [1, 2, 4], g: [1, 2, 4, 5], h: [1, 2, 5], i: [2, 4], j: [2, 4, 5],
  k: [1, 3], l: [1, 2, 3], m: [1, 3, 4], n: [1, 3, 4, 5], o: [1, 3, 5],
  p: [1, 2, 3, 4], q: [1, 2, 3, 4, 5], r: [1, 2, 3, 5], s: [2, 3, 4], t: [2, 3, 4, 5],
  u: [1, 3, 6], v: [1, 2, 3, 6], w: [2, 4, 5, 6], x: [1, 3, 4, 6], y: [1, 3, 4, 5, 6], z: [1, 3, 5, 6],
};

function dotsToByte(dots) {
  return dots.reduce((byte, dot) => byte | (1 << (dot - 1)), 0);
}

export const LETTER_PATTERNS = Object.fromEntries(
  ALPHABET.map((ch) => [ch, dotsToByte(DOTS[ch])]),
);
