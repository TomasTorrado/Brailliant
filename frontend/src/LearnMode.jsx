// LearnMode.jsx
//
// Teaches the Braille alphabet A-Z. Shows the current letter and its Braille
// cell, and on every letter change POSTs /actuate/{letter} so the physical
// solenoid cell raises the same dots — even when the on-screen cell is hidden
// (self-testing: feel the dots, guess the letter, then reveal).

import { useEffect, useRef, useState } from 'react';
import BrailleCell from './BrailleCell';
import { ALPHABET, LETTER_PATTERNS } from './braille';

export default function LearnMode({ backendUrl, onBack }) {
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  const debounceRef = useRef(null);

  const letter = ALPHABET[index];
  const pattern = LETTER_PATTERNS[letter];

  const step = (delta) => setIndex((i) => (i + delta + 26) % 26);

  // Drive the hardware for the current letter whenever it changes (incl. the
  // first render). Debounced so holding an arrow key doesn't flood serial.
  // Runs regardless of `hidden` — hiding only affects the on-screen cell.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`${backendUrl}/actuate/${letter}`, { method: 'POST' }).catch(() => {});
    }, 120);
    return () => clearTimeout(debounceRef.current);
  }, [letter, backendUrl]);

  // Keyboard: arrows navigate, H hides/shows, B/Escape returns to the menu.
  useEffect(() => {
    function handleKeyDown(event) {
      const key = event.key.toLowerCase();
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (key === 'h') setHidden((h) => !h);
      else if (key === 'b' || event.key === 'Escape') onBack();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-8 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.22em] text-subtext">
        Learn Mode · The Braille Alphabet
      </p>

      <span className="inline-block rounded-2xl border-3 border-border bg-primary px-9 py-3 text-8xl font-extrabold leading-none text-text shadow-brutal">
        {letter.toUpperCase()}
      </span>

      <div className="flex min-h-[172px] items-center justify-center">
        {hidden ? (
          <div className="flex h-[172px] w-32 flex-col items-center justify-center gap-1.5 rounded-2xl border-3 border-dashed border-subtext bg-cardBg shadow-brutal">
            <span className="text-6xl font-extrabold leading-none text-subtext">?</span>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-subtext">Hidden</span>
          </div>
        ) : (
          <BrailleCell currentPattern={pattern} />
        )}
      </div>

      <button
        onClick={() => setHidden((h) => !h)}
        className="inline-flex items-center gap-2.5 rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
      >
        {hidden ? 'Show Braille' : 'Hide Braille'}
        <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">H</kbd>
      </button>

      <div className="flex gap-4">
        <button
          onClick={() => step(-1)}
          className="min-w-[120px] rounded-xl border-3 border-border bg-purple px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          ← Back
        </button>
        <button
          onClick={() => step(1)}
          className="min-w-[120px] rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          Next →
        </button>
      </div>

      <div className="mt-1 flex max-w-xl flex-wrap justify-center gap-2">
        {ALPHABET.map((ch, i) => (
          <button
            key={ch}
            onClick={() => setIndex(i)}
            className={
              'h-11 w-11 rounded-lg border-3 border-border text-base font-extrabold text-text transition-transform active:translate-x-0.5 active:translate-y-0.5 ' +
              (i === index ? 'bg-primary shadow-brutal-sm' : 'bg-cardBg')
            }
          >
            {ch.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-col items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2.5 rounded-xl border-3 border-border bg-cardBg px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          Back to Menu
          <kbd className="rounded-md border-3 border-border bg-bg px-2 py-0.5 text-sm font-extrabold">B</kbd>
        </button>
        <p className="text-sm font-semibold text-subtext">
          Use <b>←</b> / <b>→</b> to move · <b>H</b> to hide · <b>B</b> for menu
        </p>
      </div>
    </div>
  );
}
