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

export default function App() {
  const [uploaded, setUploaded] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [word, setWord] = useState('');
  const [patterns, setPatterns] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

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

  if (!uploaded) {
    return (
      <PDFUploader
        backendUrl={BACKEND_HTTP_URL}
        onUploaded={(data) => {
          setWordCount(data.word_count);
          setUploaded(true);
        }}
      />
    );
  }

  const currentPattern = activeIndex >= 0 ? patterns[activeIndex] : 0;
  const nextPattern = activeIndex + 1 < patterns.length ? patterns[activeIndex + 1] : 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 p-8">
      <p className="text-sm uppercase tracking-widest text-neutral-500">
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
          className="rounded-lg bg-neutral-800 px-6 py-3 text-lg hover:bg-neutral-700"
        >
          Repeat
        </button>
        <button
          onClick={() => sendControl('next')}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-lg hover:bg-emerald-500"
        >
          Next
        </button>
      </div>
    </div>
  );
}
