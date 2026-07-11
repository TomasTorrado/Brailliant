// App.jsx
//
// Top-level component. Two screens:
//   1. PDFUploader — pick a PDF, POST it to the backend.
//   2. Reader view — open a WebSocket to the backend and render whatever
//      step it sends. The hardware is a single Braille cell, so reading is
//      fully manual: the backend only moves when a next/back command comes
//      in (from the on-screen buttons or the ESP32's physical buttons), one
//      letter at a time.

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

      if (message.type === 'letter') {
        setWord(message.word);
        setPatterns(message.patterns);
        setActiveIndex(message.index);
      } else if (message.type === 'word_end') {
        setWord(message.word);
        setPatterns([]);
        setActiveIndex(-1);
      } else if (message.type === 'empty') {
        setWord('');
        setPatterns([]);
        setActiveIndex(-1);
      }
    };

    return () => ws.close();
  }, [uploaded]);

  // Arrow keys mirror the physical ESP32 buttons for testing without hardware:
  // right = next, left = back.
  useEffect(() => {
    if (!uploaded) return;

    function handleKeyDown(event) {
      if (event.key === 'ArrowRight') sendControl('next');
      else if (event.key === 'ArrowLeft') sendControl('back');
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uploaded]);

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
          onClick={() => sendControl('back')}
          className="rounded-lg bg-neutral-800 px-6 py-3 text-lg hover:bg-neutral-700"
        >
          Back
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
