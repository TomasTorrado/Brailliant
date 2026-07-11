// App.jsx
//
// Top-level component. Two screens:
//   1. PDFUploader — pick a PDF, POST it to the backend.
//   2. Reader view — open a WebSocket to the backend, advance through
//      words/characters as events stream in, speak each word aloud with
//      the Web Speech API, and render the current Braille cell.
//
// The backend is the source of truth for pacing (it paces itself to match
// the physical solenoids), so the frontend just reacts to whatever event
// arrives next.

import { useEffect, useRef, useState } from 'react';
import PDFUploader from './PDFUploader';
import WordDisplay from './WordDisplay';
import BrailleCell from './BrailleCell';

const BACKEND_HTTP_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8000/ws';

// Decorative brand mark: a mini 2x3 dot grid echoing the physical Braille
// cell, rendered in a rounded neobrutalist chip.
function LogoMark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl border-3 border-border bg-primary shadow-brutal-sm">
      <div className="grid grid-cols-2 gap-[3px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="block h-1.5 w-1.5 rounded-full bg-text" />
        ))}
      </div>
    </div>
  );
}

function ThemeToggle({ dark, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Toggle dark mode"
      onClick={onToggle}
      className="relative h-8 w-14 shrink-0 overflow-hidden rounded-full border-3 border-border bg-toggleBg transition-colors duration-300"
    >
      <span
        className={
          'absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-3 border-border bg-cardBg shadow-brutal-sm transition-transform duration-300 ' +
          (dark ? 'translate-x-7' : 'translate-x-1')
        }
      />
    </button>
  );
}

function Header({ dark, onToggleDark }) {
  return (
    <header className="flex items-center justify-between border-b-3 border-border bg-bg px-6 py-4 transition-colors duration-300">
      <div className="flex items-center gap-3">
        <LogoMark />
        <span className="text-xl font-extrabold tracking-tight text-text">Brailliant</span>
      </div>
      <ThemeToggle dark={dark} onToggle={onToggleDark} />
    </header>
  );
}

export default function App() {
  const [uploaded, setUploaded] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [word, setWord] = useState('');
  const [patterns, setPatterns] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(false);
  const wsRef = useRef(null);

  // Purely presentational: reflects the toggle by swapping the `.dark` class
  // that index.css uses to switch the design-token CSS variables. Doesn't
  // touch any of the WebSocket/reader state above.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    if (!uploaded) return;

    const ws = new WebSocket(BACKEND_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'word_start') {
        setWord(message.word);
        setPatterns(message.patterns);
        setActiveIndex(-1);
        // Speak the whole word as soon as we know it, timed roughly to the
        // character-by-character solenoid/highlight animation.
        speak(message.word);
      } else if (message.type === 'char') {
        setActiveIndex((i) => i + 1);
      } else if (message.type === 'empty') {
        setWord('');
        setPatterns([]);
        setActiveIndex(-1);
      }
      // "word_end" is a no-op on the frontend; the next word_start resets state.
    };

    return () => ws.close();
  }, [uploaded]);

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // don't let words pile up
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  async function sendControl(command) {
    try {
      await fetch(`${BACKEND_HTTP_URL}/${command}`, { method: 'POST' });
    } catch {
      // backend unreachable; nothing to do in this MVP
    }
  }

  const currentPattern = activeIndex >= 0 ? patterns[activeIndex] : 0;
  const nextPattern = activeIndex + 1 < patterns.length ? patterns[activeIndex + 1] : 0;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text transition-colors duration-300">
      <Header dark={dark} onToggleDark={() => setDark((d) => !d)} />

      <main className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
        {!uploaded ? (
          <PDFUploader
            backendUrl={BACKEND_HTTP_URL}
            onUploaded={(data) => {
              setWordCount(data.word_count);
              setUploaded(true);
            }}
          />
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-widest text-subtext">
              {connected ? `Connected · ${wordCount} words` : 'Connecting…'}
            </p>

            <WordDisplay word={word} activeIndex={activeIndex} />

            <BrailleCell
              currentPattern={currentPattern}
              currentLabel={word[activeIndex] || ''}
              nextPattern={nextPattern}
              nextLabel={word[activeIndex + 1] || ''}
            />

            <div className="flex gap-4">
              <button
                onClick={() => sendControl('repeat')}
                className="rounded-xl border-3 border-border bg-purple px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                Repeat
              </button>
              <button
                onClick={() => sendControl('next')}
                className="rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                Next
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
