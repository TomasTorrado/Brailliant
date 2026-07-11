// CameraMode.jsx
//
// Live camera preview with a capture pipeline:
//   1. Grab the current video frame onto a hidden canvas.
//   2. Run OCR via macOS's Vision framework (window.electronAPI.recognizeText
//      — a native bridge to a compiled Swift helper, see
//      electron/native/ocr_helper.swift) to get plain text. Vision is built
//      for exactly this "text somewhere in a real-world photo" case — no
//      preprocessing needed.
//   3. POST that text to the backend's /upload-text, then hand control back
//      to the parent via onCaptured — same shape as PDFUploader's
//      onUploaded, so App.jsx swaps into the same reading view either way.
//
// No positioning/framing guidance yet (that's the solenoid-guided "next
// step" — this just takes whatever's in frame when the user captures).
//
// This capture pipeline is Electron-only (window.electronAPI.recognizeText
// requires the native Vision bridge) — it won't work in a plain browser tab.

import { useEffect, useRef, useState } from 'react';

export default function CameraMode({ onBack, backendUrl, onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  // starting | live | error | capturing | processing
  const [status, setStatus] = useState('starting');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setErrorMessage('Camera access is not available on this device.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Request the highest resolution the camera offers — OCR accuracy
          // depends heavily on pixels-per-character, and the default
          // resolution (often 640x480) is too low for small print.
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus('live');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(err?.message || 'Could not start the camera.');
      }
    }

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Space or C triggers a capture, mirroring this app's other single-key
  // shortcuts (M/X on the landing page, B for back).
  useEffect(() => {
    function handleKeyDown(event) {
      if (status !== 'live') return;
      if (event.key === ' ' || event.key.toLowerCase() === 'c') {
        event.preventDefault();
        capture();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (!window.electronAPI?.recognizeText) {
      setStatus('error');
      setErrorMessage('Camera OCR requires the desktop app (native Vision bridge unavailable).');
      return;
    }

    setStatus('capturing');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL('image/png');

    setStatus('processing');
    try {
      const text = await window.electronAPI.recognizeText(frame);

      const response = await fetch(`${backendUrl}/upload-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const data = await response.json();
      onCaptured(data);
    } catch (err) {
      setStatus('live');
      setErrorMessage(err?.message || 'Could not read text from that image.');
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-4xl font-extrabold text-text">Camera Mode</h1>
        <p className="mt-2 max-w-md text-subtext">
          Point the camera at printed text. It will be read word by word and embossed
          live on the physical Braille display.
        </p>
      </div>

      <div className="relative w-full overflow-hidden rounded-xl border-3 border-border bg-cardBg shadow-brutal">
        <div className="aspect-video w-full">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={
              'h-full w-full object-cover ' +
              (status === 'live' || status === 'capturing' ? 'block' : 'hidden')
            }
          />
          {status !== 'live' && status !== 'capturing' && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6">
              <p className="text-xl font-bold text-text">
                {status === 'starting'
                  ? 'Starting camera…'
                  : status === 'processing'
                    ? 'Reading text…'
                    : 'Camera unavailable'}
              </p>
              {status === 'error' && (
                <p className="text-sm font-semibold text-subtext">{errorMessage}</p>
              )}
            </div>
          )}
        </div>

        <span className="absolute left-3 top-3 rounded-lg border-3 border-border bg-teal px-3 py-1 text-xs font-bold uppercase tracking-widest text-text shadow-brutal-sm">
          {status === 'live'
            ? '● Live'
            : status === 'starting'
              ? 'Connecting'
              : status === 'capturing' || status === 'processing'
                ? 'Reading…'
                : 'Offline'}
        </span>
      </div>

      {/* Hidden capture buffer — never shown, just used to grab a frame. */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-4">
        <button
          onClick={capture}
          disabled={status !== 'live'}
          className="inline-flex items-center gap-2 rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Capture
          <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">Space</kbd>
        </button>

        <button
          onClick={onBack}
          className="rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          Back to Menu
        </button>
      </div>
    </div>
  );
}
