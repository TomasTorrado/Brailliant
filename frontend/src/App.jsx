// App.jsx
//
// Top-level component. Screens:
//   0. LandingPage    — pick an input mode (M = camera, S = screenshot, X = PDF, L = learn).
//   1. CameraMode     — live camera preview, captures + OCRs a frame client-side.
//   2. ScreenshotMode — captures the screen (getDisplayMedia) + OCRs it client-side.
//   3. LearnMode      — step through the Braille alphabet A-Z; each letter
//      POSTs /actuate/{letter} so the solenoid cell shows the same dots.
//   4. PDFUploader    — pick a PDF, POST it to the backend.
//   4. Reader view — open a WebSocket to the backend and render whatever
//      step it sends. The hardware is a single Braille cell, so reading is
//      fully manual: the backend only moves when a next/back command comes
//      in (from the on-screen buttons or the ESP32's physical buttons), one
//      letter at a time.

import { useEffect, useRef, useState } from 'react';
import LandingPage from './LandingPage';
import CameraMode from './CameraMode';
import ScreenshotMode from './ScreenshotMode';
import LearnMode from './LearnMode';
import PDFUploader from './PDFUploader';
import WordDisplay from './WordDisplay';
import BrailleCell from './BrailleCell';

const BACKEND_HTTP_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8000/ws';

// Decorative brand mark: a mini 2x3 dot grid echoing the physical Braille
// cell, rendered in a rounded neobrutalist chip.
function LogoMark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl border-3 border-border bg-yellow shadow-brutal-sm">
      <div className="grid grid-cols-2 gap-[3px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="block h-1.5 w-1.5 rounded-full bg-text" />
        ))}
      </div>
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-text">
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-text">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinejoin="round" />
    </svg>
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
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-3 border-border bg-toggleBg shadow-brutal-sm transition-all duration-300 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
    >
      {dark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function DocumentEndMessage() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border-3 border-border bg-cardBg p-8 text-center shadow-brutal">
      <p className="text-4xl font-extrabold text-text">End of Document</p>
      <p className="text-base font-semibold text-subtext">
        You've reached the end. Press Back to review the last word.
      </p>
    </div>
  );
}

function ProgressBar({ current, total, percent }) {
  return (
    <div className="w-full max-w-md">
      <div className="mb-2 flex items-center justify-between text-lg font-bold text-subtext">
        <span>
          Word {current} of {total}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-8 w-full overflow-hidden rounded-full border-3 border-border bg-cardBg">
        <div className="h-full bg-teal transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
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
  const [mode, setMode] = useState(null); // null (landing) | 'camera' | 'screenshot' | 'pdf' | 'learn'
  const [uploaded, setUploaded] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [word, setWord] = useState('');
  const [patterns, setPatterns] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const [documentEnded, setDocumentEnded] = useState(false);
  const wsRef = useRef(null);
  const prevStepRef = useRef({ type: null, index: null });

  // Purely presentational: reflects the toggle by swapping the `.dark` class
  // that index.css uses to switch the design-token CSS variables. Doesn't
  // touch any of the WebSocket/reader state above.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    if (!uploaded) return;

    prevStepRef.current = { type: null, index: null };
    setWordIndex(0);

    const ws = new WebSocket(BACKEND_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const prev = prevStepRef.current;

      setDocumentEnded(message.type === 'document_end');

      if (message.type === 'letter') {
        // Backend doesn't send a word position, but "word_end -> letter" only
        // ever happens by stepping into the next word, so we can derive it.
        if (prev.type === 'word_end') setWordIndex((i) => i + 1);
        setWord(message.word);
        setPatterns(message.patterns);
        setActiveIndex(message.index);
      } else if (message.type === 'word_end') {
        if (prev.type === 'letter' && prev.index === 0) setWordIndex((i) => i - 1);
        setWord(message.word);
        setPatterns([]);
        setActiveIndex(-1);
      } else if (message.type === 'empty') {
        setWord('');
        setPatterns([]);
        setActiveIndex(-1);
        setWordIndex(0);
      } else if (message.type === 'document_end') {
        setWord('');
        setPatterns([]);
        setActiveIndex(-1);
      }

      prevStepRef.current = { type: message.type, index: message.index ?? null };
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

  // On the PDF upload screen, B returns to the landing page (mirrors the
  // on-screen "Back to Menu" button).
  useEffect(() => {
    if (mode !== 'pdf' || uploaded) return;

    function handleKeyDown(event) {
      if (event.key.toLowerCase() === 'b') handleBackToMenu();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, uploaded]);

  async function sendControl(command) {
    try {
      await fetch(`${BACKEND_HTTP_URL}/${command}`, { method: 'POST' });
    } catch {
      // backend unreachable; nothing to do in this MVP
    }
  }

  function handleNewDocument() {
    setUploaded(false);
    setWord('');
    setPatterns([]);
    setActiveIndex(-1);
    setWordIndex(0);
    setWordCount(0);
    setConnected(false);
    setDocumentEnded(false);
  }

  // Return to the landing page and clear any in-progress reading session.
  function handleBackToMenu() {
    handleNewDocument();
    setMode(null);
  }

  const currentPattern = activeIndex >= 0 ? patterns[activeIndex] : 0;
  const currentWordNumber = wordCount > 0 ? (((wordIndex % wordCount) + wordCount) % wordCount) + 1 : 0;
  const progressPercent = wordCount > 0 ? Math.round((currentWordNumber / wordCount) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text transition-colors duration-300">
      <Header dark={dark} onToggleDark={() => setDark((d) => !d)} />

      <main className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
        {mode === null ? (
          <LandingPage onSelectMode={setMode} />
        ) : uploaded ? (
          <>
            <p className="mt-4 text-base font-bold uppercase tracking-widest text-subtext">
              {connected ? `Connected · ${wordCount} words` : 'Connecting…'}
            </p>

            <ProgressBar current={currentWordNumber} total={wordCount} percent={progressPercent} />

            {documentEnded ? (
              <DocumentEndMessage />
            ) : (
              <>
                <WordDisplay word={word} activeIndex={activeIndex} />
                <BrailleCell currentPattern={currentPattern} currentLabel={word[activeIndex] || ''} />
              </>
            )}

            <div className="flex gap-4">
              <button
                onClick={() => sendControl('back')}
                className="rounded-xl border-3 border-border bg-purple px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                Back
              </button>
              <button
                onClick={() => sendControl('next')}
                className="rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                Next
              </button>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleNewDocument}
                className="rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                Upload New Document
              </button>
              <button
                onClick={handleBackToMenu}
                className="rounded-xl border-3 border-border bg-cardBg px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                Back to Menu
              </button>
            </div>
          </>
        ) : mode === 'camera' ? (
          <CameraMode
            onBack={handleBackToMenu}
            backendUrl={BACKEND_HTTP_URL}
            onCaptured={(data) => {
              setWordCount(data.word_count);
              setUploaded(true);
            }}
          />
        ) : mode === 'screenshot' ? (
          <ScreenshotMode
            onBack={handleBackToMenu}
            backendUrl={BACKEND_HTTP_URL}
            onCaptured={(data) => {
              setWordCount(data.word_count);
              setUploaded(true);
            }}
          />
        ) : mode === 'learn' ? (
          <LearnMode backendUrl={BACKEND_HTTP_URL} onBack={handleBackToMenu} />
        ) : (
          <div className="flex w-full flex-col items-center gap-6">
            <PDFUploader
              backendUrl={BACKEND_HTTP_URL}
              onUploaded={(data) => {
                setWordCount(data.word_count);
                setUploaded(true);
              }}
            />
            <button
              onClick={handleBackToMenu}
              className="inline-flex items-center gap-2 rounded-xl border-3 border-border bg-cardBg px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
            >
              Back to Menu
              <kbd className="rounded-md border-3 border-border bg-bg px-2 py-0.5 text-sm font-extrabold">B</kbd>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
