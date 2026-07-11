// ScreenshotMode.jsx
//
// Screen-capture pipeline, mirroring CameraMode's capture -> OCR -> review ->
// send-to-reader flow but sourced from the screen instead of the camera:
//   1. A small draggable badge sits on top of whatever page/app you're
//      reading, showing the capture hotkey. It carries no live preview —
//      positioning it is just about moving it out of the way of the content
//      you're about to capture.
//   2. Pressing the capture key calls getDisplayMedia(), which pops the
//      browser/OS's own screen/window/tab picker (this permission prompt
//      can't be skipped or pre-empted — it's a browser security boundary).
//   3. We grab exactly one frame from the resulting stream onto a hidden
//      canvas, then immediately stop the stream so the "sharing" indicator
//      goes away right after the capture.
//   4. Run Tesseract.js OCR on that frame directly. Unlike CameraMode's
//      photos of real-world printed text, a screenshot is already
//      high-contrast digital text with no lighting/glare to fight, so we
//      skip the OpenCV preprocessing pass entirely, and leave Tesseract's
//      default (AUTO) page segmentation alone instead of forcing
//      SINGLE_BLOCK — a full-screen capture is a real page layout (nav,
//      sidebars, multiple columns), not one cropped-to-subject photo.
//   5. Same debug-preview-then-explicit-send flow as CameraMode: nothing
//      reaches /upload-text until you review the OCR text and click
//      "Use This Text".

import { useEffect, useRef, useState } from 'react';

export default function ScreenshotMode({ onBack, backendUrl, onCaptured }) {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const badgeRef = useRef(null);
  const dragStateRef = useRef(null);

  // idle | requesting | capturing | processing | error
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [debugPreview, setDebugPreview] = useState(null); // { raw, text } | null
  const [badgePos, setBadgePos] = useState({ x: 24, y: 24 });

  const supported = !!navigator.mediaDevices?.getDisplayMedia;

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // C (or Space) triggers a capture, mirroring CameraMode's shortcut.
  useEffect(() => {
    function handleKeyDown(event) {
      if (status === 'requesting' || status === 'processing') return;
      if (event.key === ' ' || event.key.toLowerCase() === 'c') {
        event.preventDefault();
        capture();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Plain pointer-drag for the badge: no library needed for a single
  // draggable element. Position is clamped to stay fully on-screen.
  function handleBadgePointerDown(event) {
    const rect = badgeRef.current.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handlePointerMove(event) {
    const drag = dragStateRef.current;
    if (!drag) return;
    const rect = badgeRef.current.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;
    setBadgePos({
      x: Math.min(Math.max(event.clientX - drag.offsetX, 0), Math.max(maxX, 0)),
      y: Math.min(Math.max(event.clientY - drag.offsetY, 0), Math.max(maxY, 0)),
    });
  }

  function handlePointerUp() {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }

  async function capture() {
    if (!supported) return;

    setStatus('requesting');
    setErrorMessage('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });
    } catch (err) {
      // Most commonly the user dismissed the OS/browser picker — not a real
      // error, just no capture this time.
      setStatus('idle');
      if (err?.name !== 'NotAllowedError') {
        setErrorMessage(err?.message || 'Could not start screen capture.');
      }
      return;
    }

    setStatus('capturing');
    try {
      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });
      await video.play();

      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    } finally {
      // Release the share as soon as we have our one frame, so the browser's
      // "sharing your screen" indicator doesn't linger.
      stream.getTracks().forEach((t) => t.stop());
    }

    const canvas = canvasRef.current;
    const rawPreview = canvas.toDataURL('image/png');
    setDebugPreview({ raw: rawPreview, text: null });

    setStatus('processing');
    try {
      if (!workerRef.current) {
        const { createWorker, OEM } = await import('tesseract.js');
        workerRef.current = await createWorker('eng', OEM.LSTM_ONLY);
      }
      const {
        data: { text },
      } = await workerRef.current.recognize(canvas);
      setDebugPreview({ raw: rawPreview, text });
      setStatus('idle');
    } catch (err) {
      setStatus('idle');
      setErrorMessage(err?.message || 'Could not read text from that screenshot.');
    }
  }

  async function sendToReader() {
    try {
      const response = await fetch(`${backendUrl}/upload-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: debugPreview.text }),
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const data = await response.json();
      onCaptured(data);
    } catch (err) {
      setErrorMessage(err?.message || 'Could not send that text to the reader.');
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-4xl font-extrabold text-text">Screenshot Mode</h1>
        <p className="mt-2 max-w-md text-subtext">
          Drag the badge out of the way, then press{' '}
          <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">C</kbd> to
          capture your screen. It will be read word by word and embossed live on the physical Braille display.
        </p>
      </div>

      {!supported ? (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border-3 border-border bg-cardBg p-8 shadow-brutal">
          <p className="text-xl font-bold text-text">Screen capture unavailable</p>
          <p className="text-sm font-semibold text-subtext">
            This browser doesn't support screen capture. Try Chrome or Edge on desktop.
          </p>
        </div>
      ) : (
        <div
          ref={badgeRef}
          onPointerDown={handleBadgePointerDown}
          style={{ left: badgePos.x, top: badgePos.y }}
          className="fixed z-50 flex cursor-grab select-none items-center gap-3 rounded-xl border-3 border-border bg-purple px-4 py-3 shadow-brutal active:cursor-grabbing"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-3 border-border bg-cardBg">
            <div className="grid grid-cols-2 gap-[2px]">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="block h-1 w-1 rounded-full bg-text" />
              ))}
            </div>
          </div>
          <div className="text-left">
            <p className="text-sm font-extrabold uppercase tracking-widest text-text">
              {status === 'requesting'
                ? 'Choose a screen…'
                : status === 'capturing'
                  ? 'Capturing…'
                  : status === 'processing'
                    ? 'Reading text…'
                    : 'Ready'}
            </p>
            <p className="text-xs font-semibold text-text/80">
              Press <kbd className="rounded border-2 border-border bg-cardBg px-1">C</kbd> to capture
            </p>
          </div>
        </div>
      )}

      {errorMessage && <p className="text-sm font-semibold text-subtext">{errorMessage}</p>}

      {/* Hidden capture buffer — never shown, just used to grab a single frame. */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-4">
        <button
          onClick={capture}
          disabled={!supported || status === 'requesting' || status === 'processing'}
          className="inline-flex items-center gap-2 rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Capture Screenshot
          <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">C</kbd>
        </button>

        <button
          onClick={onBack}
          className="rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          Back to Menu
        </button>
      </div>

      {debugPreview && (
        <div className="flex w-full flex-col gap-4 rounded-xl border-3 border-border bg-cardBg p-4 text-left shadow-brutal">
          <p className="text-xs font-bold uppercase tracking-widest text-subtext">
            Debug: last capture (temporary — remove once OCR is tuned)
          </p>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase text-subtext">Captured screenshot</span>
            <img src={debugPreview.raw} alt="Captured screenshot" className="max-h-64 rounded-lg border-3 border-border" />
          </div>

          {debugPreview.text !== null && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase text-subtext">Raw OCR output</span>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border-3 border-border bg-bg p-3 text-sm text-text">
                  {debugPreview.text || '(empty)'}
                </pre>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={sendToReader}
                  className="rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
                >
                  Use This Text
                </button>
                <button
                  onClick={() => setDebugPreview(null)}
                  className="rounded-xl border-3 border-border bg-cardBg px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
                >
                  Retry
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
