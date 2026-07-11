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

// Camera Movement Standard — the on-screen half of the same scheme the backend
// pushes to the physical cell (see backend/main.py CAMERA_DIRECTION_PATTERNS).
// The arrow points at where the object currently sits, i.e. the way to move.
const DIRECTION_META = {
  up: { arrow: '↑', label: 'Move up' },
  down: { arrow: '↓', label: 'Move down' },
  left: { arrow: '←', label: 'Move left' },
  right: { arrow: '→', label: 'Move right' },
  'up-left': { arrow: '↖', label: 'Move up-left' },
  'up-right': { arrow: '↗', label: 'Move up-right' },
  'down-left': { arrow: '↙', label: 'Move down-left' },
  'down-right': { arrow: '↘', label: 'Move down-right' },
  centered: { arrow: '●', label: 'Centered — hold still' },
};

// Detection is powered by the SAME macOS Vision engine that does the final OCR
// (window.electronAPI.detectText → ocr_helper --fast --json), just in a quick
// mode that returns each text run's bounding box + confidence. This is a huge
// step up from the old edge-density heuristic: Vision actually knows text from
// not-text, so it never locks onto a face, and the guidance aims at the real
// text centroid. Vision's own confidence doubles as our "is this legible?"
// gate, so auto-capture only fires on frames OCR will actually read well.
const DETECT_W = 720; // downscaled detection-frame width (keeps small text legible, stays fast)
const DETECT_INTERVAL_MS = 120; // gap between detection passes (warm --serve process keeps this cheap)
const MIN_CONFIDENCE = 0.3; // ignore text runs below this when locating / counting text

// Centre dead-zones, per axis (fraction of half-frame). Horizontal is tight so
// the guidance actively says "move left / move right" to line the text up;
// vertical is looser because text naturally sits high on a page and that axis
// is the noisiest, so we don't want to nag up/down. Each axis has a wider
// "exit" zone (hysteresis) so, once centred, small drift doesn't start nudging.
const DEAD_ZONE_X = 0.06;
const EXIT_ZONE_X = 0.1;
const DEAD_ZONE_Y = 0.09;
const EXIT_ZONE_Y = 0.14;
const CENTROID_SMOOTHING = 0.6; // EMA factor on the tracked text region (higher = snappier/less lag)

// Pad the drawn tracking box out beyond the tight text extent so it reads as a
// box around the whole object, not just the ink. Purely visual — direction is
// still computed from the true (unpadded) box centre.
const BOX_DISPLAY_PADDING = 0.28; // fraction of box size added on each side

// Object-tracking stability. Vision-fast catches a slightly different subset of
// text lines each pass, which used to jerk the arrow ("move down" when nothing
// really moved). So we track the text region across passes: hold the last
// guidance through brief detection dropouts (GRACE_MISSES), and only commit a
// NEW direction once the raw reading agrees for a couple of passes
// (DIRECTION_CONFIRM_PASSES) — one bad frame can no longer flip the arrow.
const GRACE_MISSES = 3; // keep guiding through this many text-less passes before "searching"
const DIRECTION_CONFIRM_PASSES = 1; // commit a new direction immediately (react fast to movement)

// Auto-capture gate — only shoot a frame a person would: text centred, Vision
// reading it CONFIDENTLY (legible, in focus, well lit), and STEADY (centroid
// barely drifting, which also lets autofocus settle).
const CAPTURE_MIN_CONFIDENCE = 0.4; // mean Vision confidence needed to auto-capture
const CAPTURE_STEADY_MAX = 0.04; // max smoothed-centroid drift per pass to count as steady
const CAPTURE_READY_CYCLES = 2; // consecutive good passes (~1.1s) before it fires

export default function CameraMode({ onBack, backendUrl, onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectCanvasRef = useRef(null);
  const streamRef = useRef(null);
  // starting | live | error | capturing | processing
  const [status, setStatus] = useState('starting');
  const [errorMessage, setErrorMessage] = useState('');

  // Live guidance from Vision: direction + the metrics behind the capture gate.
  // `direction` is a key of DIRECTION_META (or null when no text is detected).
  // `unsupported` is true in a plain browser (no native Vision bridge).
  const [guidance, setGuidance] = useState({
    direction: null,
    detected: false,
    confidence: 0,
    boxes: 0,
    steady: false,
    box: null,
    unsupported: false,
  });
  const [log, setLog] = useState([]); // most-recent-first list of guidance events

  // Refs used inside the detection loop so it doesn't churn on every state
  // change: last direction sent to the backend, the consecutive-good-pass
  // counter, the EMA-smoothed centroid (for steadiness + hysteresis), whether
  // we were centred last pass (hysteresis), a one-shot auto-capture latch, a
  // monotonic log id, and the freshest capture() closure.
  const lastDirectionRef = useRef(null);
  const captureReadyCyclesRef = useRef(0);
  const smoothedBoxRef = useRef(null); // tracked union box { x, y, w, h }, or null
  const committedDirectionRef = useRef(null); // the direction currently shown/sent
  const pendingDirectionRef = useRef({ direction: null, count: 0 }); // debounce for a change
  const missRef = useRef(0); // consecutive passes with no confident text
  const autoCapturedRef = useRef(false);
  const logIdRef = useRef(0);
  const captureRef = useRef(null);

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

  // Space or C triggers a capture; B returns to the menu — mirroring this
  // app's other single-key shortcuts (M/X on the landing page). B works in
  // any state so you can always back out, even mid-error.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onBack();
        return;
      }
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

  // POST the current direction to the backend, which translates it to the
  // Camera Movement Standard dot pattern and drives the ESP32. Fire-and-forget
  // — guidance shouldn't stall on a slow/absent backend.
  function sendGuide(direction) {
    fetch(`${backendUrl}/guide/${direction}`, { method: 'POST' }).catch(() => {});
  }

  function pushLog(direction) {
    const meta = DIRECTION_META[direction];
    const id = (logIdRef.current += 1);
    setLog((prev) => [{ id, direction, label: meta.label, arrow: meta.arrow }, ...prev].slice(0, 6));
  }

  // Turn Vision's text boxes into a tracked bounding box + one of the 8
  // directions (or "centered"). We track the UNION box of all confident text
  // runs — "the object with text on it" — smoothed across passes so it moves
  // like a tracker locked on, not a per-frame recompute. Direction comes from
  // that box's centre, with per-axis dead-zones and hysteresis.
  function resolveDirection(boxes) {
    const good = boxes.filter((b) => b.confidence >= MIN_CONFIDENCE);
    if (good.length === 0) return null;

    // Union box over all confident runs, plus average confidence.
    let x0 = 1;
    let y0 = 1;
    let x1 = 0;
    let y1 = 0;
    let confSum = 0;
    for (const b of good) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
      confSum += b.confidence;
    }
    const target = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

    // EMA-smooth the tracked box (position AND size) so it glides with the
    // object instead of snapping between detection subsets.
    const prev = smoothedBoxRef.current;
    const box = prev
      ? {
          x: prev.x + CENTROID_SMOOTHING * (target.x - prev.x),
          y: prev.y + CENTROID_SMOOTHING * (target.y - prev.y),
          w: prev.w + CENTROID_SMOOTHING * (target.w - prev.w),
          h: prev.h + CENTROID_SMOOTHING * (target.h - prev.h),
        }
      : target;
    smoothedBoxRef.current = box;

    const nx = box.x + box.w / 2 - 0.5; // +x = box sits right of centre
    const ny = box.y + box.h / 2 - 0.5; // +y = box sits below centre
    const prevCx = prev ? prev.x + prev.w / 2 - 0.5 : null;
    const prevCy = prev ? prev.y + prev.h / 2 - 0.5 : null;
    const drift = prev ? Math.hypot(nx - prevCx, ny - prevCy) : 1;

    // Hysteresis keyed off the *committed* centred state: once centred, the
    // box has to drift past the wider exit zone before we nudge again.
    const centered = committedDirectionRef.current === 'centered';
    const zoneX = centered ? EXIT_ZONE_X : DEAD_ZONE_X;
    const zoneY = centered ? EXIT_ZONE_Y : DEAD_ZONE_Y;
    const horiz = nx > zoneX ? 'right' : nx < -zoneX ? 'left' : '';
    const vert = ny > zoneY ? 'down' : ny < -zoneY ? 'up' : '';
    let rawDirection;
    if (!horiz && !vert) rawDirection = 'centered';
    else if (horiz && vert) rawDirection = `${vert}-${horiz}`;
    else rawDirection = horiz || vert;

    return { rawDirection, drift, confidence: confSum / good.length, boxes: good.length, box };
  }

  // Live text-tracking loop (only while the preview is live). Each pass hands a
  // downscaled frame to macOS Vision (fast mode), which returns where the text
  // is + how confident it is; we turn that into a direction, drive the arrow +
  // physical cell, and — once text is centred, confidently read, and steady —
  // auto-fire the accurate capture. Self-schedules (setTimeout after each pass
  // completes) so slow Vision calls never overlap.
  useEffect(() => {
    if (status !== 'live') return;

    if (!window.electronAPI?.detectText) {
      // Plain browser: no native Vision bridge, so no live guidance. Manual
      // capture still errors clearly; nothing to run here.
      setGuidance({ direction: null, detected: false, confidence: 0, boxes: 0, steady: false, unsupported: true });
      return;
    }

    autoCapturedRef.current = false;
    captureReadyCyclesRef.current = 0;
    smoothedBoxRef.current = null;
    lastDirectionRef.current = null;
    committedDirectionRef.current = null;
    pendingDirectionRef.current = { direction: null, count: 0 };
    missRef.current = 0;

    let cancelled = false;
    let timer = null;

    // Fully drop tracking after too many text-less passes: back to "searching".
    function loseTrack() {
      setGuidance({ direction: null, detected: false, confidence: 0, boxes: 0, steady: false, box: null, unsupported: false });
      captureReadyCyclesRef.current = 0;
      smoothedBoxRef.current = null;
      committedDirectionRef.current = null;
      pendingDirectionRef.current = { direction: null, count: 0 };
      lastDirectionRef.current = null;
    }

    async function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = detectCanvasRef.current;
      if (video && canvas && video.videoWidth > 0) {
        const h = Math.round((DETECT_W * video.videoHeight) / video.videoWidth);
        canvas.width = DETECT_W;
        canvas.height = h;
        canvas.getContext('2d').drawImage(video, 0, 0, DETECT_W, h);
        const frame = canvas.toDataURL('image/jpeg', 0.85);

        let boxes = [];
        try {
          boxes = (await window.electronAPI.detectText(frame)) || [];
        } catch {
          boxes = [];
        }
        if (cancelled) return;

        const result = resolveDirection(boxes);
        if (!result) {
          // No confident text this pass. Hold the last guidance through brief
          // dropouts (Vision-fast misses a frame now and then) rather than
          // snapping to "searching" and jerking the arrow.
          missRef.current += 1;
          captureReadyCyclesRef.current = 0;
          if (missRef.current > GRACE_MISSES || !committedDirectionRef.current) loseTrack();
        } else {
          missRef.current = 0;
          const { rawDirection, drift, confidence, boxes: n, box } = result;
          const steady = drift <= CAPTURE_STEADY_MAX;

          // Debounce direction CHANGES: a new reading must repeat for a couple
          // of passes before it's committed, so a single stray frame can't flip
          // the arrow (e.g. a spurious "move down").
          let committed = committedDirectionRef.current;
          if (rawDirection === committed) {
            pendingDirectionRef.current = { direction: null, count: 0 };
          } else {
            const pending = pendingDirectionRef.current;
            const count = pending.direction === rawDirection ? pending.count + 1 : 1;
            pendingDirectionRef.current = { direction: rawDirection, count };
            if (count >= DIRECTION_CONFIRM_PASSES || committed === null) {
              committed = rawDirection;
              committedDirectionRef.current = committed;
              pendingDirectionRef.current = { direction: null, count: 0 };
            }
          }

          setGuidance({ direction: committed, detected: true, confidence, boxes: n, steady, box, unsupported: false });

          if (committed !== lastDirectionRef.current) {
            lastDirectionRef.current = committed;
            pushLog(committed);
            sendGuide(committed);
          }

          // Fire only on a frame a person would pick: centred, Vision confident
          // (legible/in focus), and steady — held for a couple of passes.
          const ready = committed === 'centered' && confidence >= CAPTURE_MIN_CONFIDENCE && steady;
          if (ready) {
            captureReadyCyclesRef.current += 1;
            if (captureReadyCyclesRef.current >= CAPTURE_READY_CYCLES && !autoCapturedRef.current) {
              autoCapturedRef.current = true;
              captureRef.current?.();
            }
          } else {
            captureReadyCyclesRef.current = 0;
          }
        }
      }
      if (!cancelled) timer = setTimeout(tick, DETECT_INTERVAL_MS);
    }

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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
      // Cap the OCR call so a stalled native helper can't leave us stuck on
      // "Reading text…" forever — fall back to live and let the user retry.
      const text = await Promise.race([
        window.electronAPI.recognizeText(frame),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Text recognition timed out — try again.')), 8000),
        ),
      ]);

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

  // Keep the detection loop's capture reference fresh without re-arming the
  // interval every render.
  captureRef.current = capture;

  const guideMeta = guidance.direction ? DIRECTION_META[guidance.direction] : null;

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-4xl font-extrabold text-text">Camera Mode</h1>
        <p className="mt-2 max-w-md text-subtext">
          Point the camera at printed text. Follow the arrow — on screen and on the
          physical cell — to centre it; it captures and reads automatically once framed.
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

          {/* Tracked text box: the union of what Vision is reading, smoothed so
              it glides with the object, padded out so it frames the whole
              object. Teal once centred, yellow while off. */}
          {status === 'live' && guidance.detected && guidance.box && (
            <div
              className={
                'pointer-events-none absolute rounded-md border-[3px] shadow-brutal-sm transition-colors ' +
                (guidance.direction === 'centered' ? 'border-teal' : 'border-yellow')
              }
              style={{
                left: `${Math.max(0, guidance.box.x - guidance.box.w * BOX_DISPLAY_PADDING) * 100}%`,
                top: `${Math.max(0, guidance.box.y - guidance.box.h * BOX_DISPLAY_PADDING) * 100}%`,
                width: `${Math.min(1, guidance.box.w * (1 + 2 * BOX_DISPLAY_PADDING)) * 100}%`,
                height: `${Math.min(1, guidance.box.h * (1 + 2 * BOX_DISPLAY_PADDING)) * 100}%`,
              }}
            />
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

        {/* Live guidance overlay: big arrow pointing toward the detected
            object, or a "searching" hint while nothing is found. */}
        {status === 'live' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {guideMeta ? (
              <div
                className={
                  'flex flex-col items-center gap-1 rounded-2xl border-3 border-border px-6 py-4 shadow-brutal ' +
                  (guidance.direction === 'centered' ? 'bg-teal' : 'bg-yellow')
                }
              >
                <span className="text-5xl font-black leading-none text-text">{guideMeta.arrow}</span>
                <span className="text-sm font-extrabold uppercase tracking-widest text-text">
                  {guideMeta.label}
                </span>
              </div>
            ) : (
              <span className="rounded-lg border-3 border-border bg-cardBg px-4 py-2 text-sm font-bold uppercase tracking-widest text-subtext shadow-brutal-sm">
                {guidance.unsupported ? 'Guidance needs the desktop app' : 'Searching for text…'}
              </span>
            )}
          </div>
        )}

        {/* Live metrics — dev aid for tuning the auto-capture gate. Each check
            turns green when it passes; auto-capture needs all three, held. */}
        {status === 'live' && guidance.detected && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-border/80 px-3 py-1.5 font-mono text-[11px] font-bold text-white">
            <span className="text-white/60">text:{guidance.boxes}</span>
            <span className={guidance.direction === 'centered' ? 'text-teal' : 'text-white/60'}>
              centred:{guidance.direction === 'centered' ? '✓' : '✗'}
            </span>
            <span className={guidance.confidence >= CAPTURE_MIN_CONFIDENCE ? 'text-teal' : 'text-white/60'}>
              conf:{guidance.confidence.toFixed(2)}/{CAPTURE_MIN_CONFIDENCE}
            </span>
            <span className={guidance.steady ? 'text-teal' : 'text-white/60'}>
              steady:{guidance.steady ? '✓' : '✗'}
            </span>
          </div>
        )}
      </div>

      {/* Hidden capture buffer — never shown, just used to grab a frame. */}
      <canvas ref={canvasRef} className="hidden" />
      {/* Hidden downscaled buffer the detection loop reads each tick. */}
      <canvas ref={detectCanvasRef} className="hidden" />

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
          className="inline-flex items-center gap-2 rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          Back to Menu
          <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">B</kbd>
        </button>
      </div>

      {/* Guidance log: the recent movement directions, newest on top. Each entry
          is exactly what was pushed to the physical cell at that moment. */}
      {log.length > 0 && (
        <div className="w-full rounded-xl border-3 border-border bg-cardBg p-4 text-left shadow-brutal">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-subtext">Guidance</p>
          <ul className="flex flex-col gap-1">
            {log.map((entry, i) => (
              <li
                key={entry.id}
                className={
                  'flex items-center gap-3 text-sm font-bold ' +
                  (i === 0 ? 'text-text' : 'text-subtext')
                }
              >
                <span className="w-6 text-center text-lg">{entry.arrow}</span>
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
