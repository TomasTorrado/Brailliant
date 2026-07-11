// CameraMode.jsx
//
// UI-only camera screen. Shows a live preview from the device camera inside a
// neobrutalist viewport so the reading flow can eventually run OCR on the
// frame. No backend wiring yet — this is the presentational shell for the
// "press M" mode. If the camera can't be opened (no permission / no device),
// it falls back to a clear message instead of a blank box.

import { useEffect, useRef, useState } from 'react';

export default function CameraMode({ onBack }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | live | error
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
          video: { facingMode: 'environment' },
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
              'h-full w-full object-cover ' + (status === 'live' ? 'block' : 'hidden')
            }
          />
          {status !== 'live' && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6">
              <p className="text-xl font-bold text-text">
                {status === 'starting' ? 'Starting camera…' : 'Camera unavailable'}
              </p>
              {status === 'error' && (
                <p className="text-sm font-semibold text-subtext">{errorMessage}</p>
              )}
            </div>
          )}
        </div>

        <span className="absolute left-3 top-3 rounded-lg border-3 border-border bg-teal px-3 py-1 text-xs font-bold uppercase tracking-widest text-text shadow-brutal-sm">
          {status === 'live' ? '● Live' : status === 'starting' ? 'Connecting' : 'Offline'}
        </span>
      </div>

      <button
        onClick={onBack}
        className="rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
      >
        Back to Menu
      </button>
    </div>
  );
}
