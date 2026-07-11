// LandingPage.jsx
//
// Entry screen shown before any reading session. Offers four modes:
//   - Camera mode     (press M) — read printed text through the device camera.
//   - Screenshot mode (press S) — capture the screen and read whatever's on it.
//   - PDF mode        (press X) — the existing upload-a-PDF flow.
//   - Learn mode      (press L) — step through the Braille alphabet A-Z.
// Clicking a card or pressing its key hands the chosen mode back up to App,
// which swaps in the matching screen. This is UI-only routing; each mode
// keeps its own existing behaviour.

import { useEffect } from 'react';

// A big neobrutalist mode card. `hotkey` is shown in a chip and also triggers
// the same `onSelect` when pressed (wired globally below).
function ModeCard({ hotkey, title, description, accent, icon, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'group flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border-3 border-border ' +
        accent +
        ' px-8 py-10 text-center shadow-brutal transition-all ' +
        'hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-brutal-lg ' +
        'active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm'
      }
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-xl border-3 border-border bg-cardBg shadow-brutal-sm">
        {icon}
      </div>
      <h2 className="text-2xl font-extrabold text-text">{title}</h2>
      <p className="text-sm font-semibold text-subtext">{description}</p>
      <span className="mt-2 inline-flex items-center gap-2 rounded-lg border-3 border-border bg-cardBg px-4 py-2 text-sm font-bold uppercase tracking-widest text-text shadow-brutal-sm">
        Press
        <kbd className="rounded-md border-3 border-border bg-bg px-2 py-0.5 font-extrabold">{hotkey}</kbd>
      </span>
    </button>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-8 w-8 text-text">
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function PDFIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-8 w-8 text-text">
      <path d="M7 3h7l4 4v14H7z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M9.5 13h5M9.5 16h5" strokeLinecap="round" />
    </svg>
  );
}

function ScreenshotIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-8 w-8 text-text">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M20 8V6a2 2 0 0 0-2-2h-2M20 16v2a2 2 0 0 1-2 2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function AlphabetIcon() {
  return (
    <div className="flex items-center gap-1.5 text-text">
      <span className="text-3xl font-extrabold leading-none">A</span>
      <span className="grid grid-cols-2 gap-[3px]">
        <span className="block h-1.5 w-1.5 rounded-full bg-text" />
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="box-border block h-1.5 w-1.5 rounded-full border-2 border-text" />
        ))}
      </span>
    </div>
  );
}

export default function LandingPage({ onSelectMode }) {
  // Global hotkeys: M -> camera, S -> screenshot, X -> PDF, L -> learn.
  // Case-insensitive so caps lock or a held shift still works.
  useEffect(() => {
    function handleKeyDown(event) {
      const key = event.key.toLowerCase();
      if (key === 'm') onSelectMode('camera');
      else if (key === 's') onSelectMode('screenshot');
      else if (key === 'x') onSelectMode('pdf');
      else if (key === 'l') onSelectMode('learn');
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectMode]);

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-10 text-center">
      <div>
        <h1 className="text-5xl font-extrabold text-text">Brailliant</h1>
        <p className="mt-3 max-w-xl text-lg text-subtext">
          Choose how you want to read — or learn the alphabet. Text is spoken word by word and
          embossed live on the physical Braille display.
        </p>
      </div>

      <div className="flex w-full flex-col items-stretch justify-center gap-8 sm:flex-row sm:flex-wrap">
        <ModeCard
          hotkey="M"
          title="Camera Mode"
          description="Point the camera at printed text and read it live."
          accent="bg-teal"
          icon={<CameraIcon />}
          onSelect={() => onSelectMode('camera')}
        />
        <ModeCard
          hotkey="S"
          title="Screenshot Mode"
          description="Capture your screen and read whatever's on it."
          accent="bg-purple"
          icon={<ScreenshotIcon />}
          onSelect={() => onSelectMode('screenshot')}
        />
        <ModeCard
          hotkey="X"
          title="PDF Mode"
          description="Upload a PDF and read it word by word."
          accent="bg-yellow"
          icon={<PDFIcon />}
          onSelect={() => onSelectMode('pdf')}
        />
        <ModeCard
          hotkey="L"
          title="Learn Mode"
          description="Learn the Braille alphabet, A to Z, and test yourself."
          accent="bg-purple"
          icon={<AlphabetIcon />}
          onSelect={() => onSelectMode('learn')}
        />
      </div>

      <p className="text-sm font-bold uppercase tracking-widest text-subtext">
        Press <kbd className="mx-1 rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-text">M</kbd>,
        <kbd className="mx-1 rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-text">S</kbd>,
        <kbd className="mx-1 rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-text">X</kbd>,
        or <kbd className="mx-1 rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-text">L</kbd>
        to begin
      </p>
    </div>
  );
}
