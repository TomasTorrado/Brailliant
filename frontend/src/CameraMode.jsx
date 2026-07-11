// CameraMode.jsx
//
// Live camera preview with a capture pipeline:
//   1. Grab the current video frame onto a hidden canvas.
//   2. Clean it up with OpenCV.js (grayscale + contrast enhancement) so
//      real-world lighting/glare hurts Tesseract less.
//   3. Run Tesseract.js OCR on the cleaned-up frame to get plain text.
//   4. POST that text to the backend's /upload-text, then hand control back
//      to the parent via onCaptured — same shape as PDFUploader's
//      onUploaded, so App.jsx swaps into the same reading view either way.
//
// No positioning/framing guidance yet (that's the solenoid-guided "next
// step" — this just takes whatever's in frame when the user captures).

import { useEffect, useRef, useState } from 'react';

// tesseract.js and @techstark/opencv-js are both large (WASM + worker
// scripts) — dynamically imported so PDF-only users never pay for them.
// @techstark/opencv-js's module may already be initialized, still loading
// (a Promise), or an object waiting on onRuntimeInitialized — this covers
// all three per the package's own usage docs.
async function getOpenCv() {
  const { default: cvModule } = await import('@techstark/opencv-js');
  if (cvModule instanceof Promise) return cvModule;
  if (cvModule.Mat) return cvModule;
  await new Promise((resolve) => {
    cvModule.onRuntimeInitialized = resolve;
  });
  return cvModule;
}

// Grayscale -> upscale -> CLAHE (adaptive contrast) -> adaptive threshold,
// in place on `canvas`. Tesseract's own docs recommend upscaling low-res
// input; CLAHE fixes uneven real-world lighting. Adaptive (not global
// Otsu) thresholding matters here specifically because the raw frame is a
// whole scene — background, lighting, the person holding the item — not a
// cropped, mostly-text image. A single global cutoff (Otsu) gets dominated
// by all that background variation and shreds the entire frame into
// arbitrary black/white noise; a per-neighborhood threshold judges each
// small region against its own local brightness instead, so a bright
// ceiling light and a dim card in the same frame don't fight over one
// global value.
//
// Block size matters a lot: too small relative to letter stroke width and
// every pixel inside a stroke looks similar to its (also-inside-the-stroke)
// neighbors, so only the stroke's edges cross the threshold — hollow
// outlines instead of solid filled letters. Humans read hollow outlines
// fine (we complete shapes visually); Tesseract, trained on solid strokes,
// does not. 41 keeps the window comfortably larger than a letter stroke.
async function preprocessForOcr(canvas) {
  const cv = await getOpenCv();
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const upscaled = new cv.Mat();
  const enhanced = new cv.Mat();
  const binary = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.resize(gray, upscaled, new cv.Size(0, 0), 2, 2, cv.INTER_CUBIC);
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(upscaled, enhanced);
    clahe.delete();
    cv.adaptiveThreshold(enhanced, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 41, 10);
    cv.imshow(canvas, binary);
  } finally {
    src.delete();
    gray.delete();
    upscaled.delete();
    enhanced.delete();
    binary.delete();
  }
}

export default function CameraMode({ onBack, backendUrl, onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const workerRef = useRef(null);
  // starting | live | error | capturing | processing
  const [status, setStatus] = useState('starting');
  const [errorMessage, setErrorMessage] = useState('');
  // Debug preview: lets us actually see what the camera captured, what
  // OpenCV produced after preprocessing, and what Tesseract read from it —
  // so a bad result can be diagnosed as "blurry photo" vs. "bad OCR" vs.
  // "preprocessing broke something," instead of guessing.
  const [debugPreview, setDebugPreview] = useState(null); // { raw, processed, text } | null

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
      workerRef.current?.terminate();
      workerRef.current = null;
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

  // Capture + preprocess + OCR only — stops here and shows the debug
  // preview so a "successful" (no-exception) but garbled read is still
  // visible before anything gets sent to the reader. sendToReader() below
  // is the explicit next step.
  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setStatus('capturing');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const rawPreview = canvas.toDataURL('image/png');
    setDebugPreview({ raw: rawPreview, processed: null, text: null });

    setStatus('processing');
    try {
      await preprocessForOcr(canvas);
      const processedPreview = canvas.toDataURL('image/png');
      setDebugPreview({ raw: rawPreview, processed: processedPreview, text: null });

      if (!workerRef.current) {
        // Explicit even though these match tesseract.js's own defaults: LSTM
        // engine (which also gets the more accurate "best" trained data,
        // vs. the legacy engine's data) and single-block page segmentation
        // (skip full page-layout guessing, since we're feeding it one
        // cropped-to-frame photo, not a multi-column page).
        const { createWorker, OEM, PSM } = await import('tesseract.js');
        workerRef.current = await createWorker('eng', OEM.LSTM_ONLY);
        await workerRef.current.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      }
      const {
        data: { text },
      } = await workerRef.current.recognize(canvas);
      setDebugPreview({ raw: rawPreview, processed: processedPreview, text });
      setStatus('live');
    } catch (err) {
      setStatus('live');
      setErrorMessage(err?.message || 'Could not read text from that image.');
    }
  }

  // Explicit hand-off to the reader, only once you've reviewed the debug
  // preview and decided the OCR text is good enough to read.
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

      {/* Hidden capture buffer — never shown, just used to grab + preprocess a frame. */}
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

      {debugPreview && (
        <div className="flex w-full flex-col gap-4 rounded-xl border-3 border-border bg-cardBg p-4 text-left shadow-brutal">
          <p className="text-xs font-bold uppercase tracking-widest text-subtext">
            Debug: last capture (temporary — remove once OCR is tuned)
          </p>

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase text-subtext">Raw frame</span>
              <img src={debugPreview.raw} alt="Raw captured frame" className="max-h-64 rounded-lg border-3 border-border" />
            </div>
            {debugPreview.processed && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase text-subtext">After OpenCV preprocessing</span>
                <img
                  src={debugPreview.processed}
                  alt="Preprocessed frame fed to Tesseract"
                  className="max-h-64 rounded-lg border-3 border-border"
                />
              </div>
            )}
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
