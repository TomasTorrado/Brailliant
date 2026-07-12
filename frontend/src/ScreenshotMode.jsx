// ScreenshotMode.jsx
//
// Screen-capture pipeline, mirroring CameraMode's current (Vision-based)
// capture -> OCR -> reader flow exactly, but sourced from a chosen window
// instead of the camera:
//   1. Pressing the capture key (or button) calls window.electronAPI
//      .listCapturableWindows() and shows an in-app picker (WindowPicker)
//      with a thumbnail + name for every open window (Brailliant's own
//      window excluded).
//   2. Clicking a window calls window.electronAPI.captureScreenshot({
//      windowId }), which shells out to macOS's `screencapture -l
//      <windowid>` to grab just that window's contents non-interactively —
//      no region-dragging, no full-screen capture of things you didn't ask
//      for.
//   3. Run OCR via macOS's Vision framework (window.electronAPI.recognizeText
//      — the same native bridge CameraMode uses) directly on the resulting
//      PNG. We pass excludeTopFraction so lines Vision finds near the top of
//      the window (its own tabs/address bar/bookmarks bar) get dropped
//      before the text ever reaches the reader — Camera Mode does NOT pass
//      this, since a real-world photo has no "browser chrome" to exclude.
//   4. POST that text to /upload-text and hand control back via onCaptured —
//      same shape as CameraMode/PDFUploader, so App.jsx swaps into the same
//      reading view regardless of source. No debug/preview step, matching
//      CameraMode's current flow.
//
// This only works inside the Electron desktop app on macOS — screencapture
// and the Vision bridge are both macOS-only, and there's no browser-only
// fallback.

import { useEffect, useState } from 'react';
import WindowPicker from './WindowPicker';

// Fraction of the captured window's height (from its own top edge) to drop
// before OCR text reaches the reader — meant to cover a browser window's own
// traffic lights/tabs/address bar/bookmarks bar. Re-tuned higher than the
// ~0.12 that worked for whole-screen captures: a single window's chrome
// takes up a noticeably bigger share of the frame once there's no
// surrounding desktop/menu-bar padding diluting it. This value came from
// real window geometry (a Chrome toolbar layer measuring ~158px against a
// ~949px total window height, macOS's CGWindowListCopyWindowInfo) rather
// than a blind guess, but I could not pixel-test an actual `-l` capture in
// this environment (screencapture -l failed outside the app's own granted
// permission context) — treat this as a starting point to verify live.
const SCREENSHOT_CHROME_EXCLUDE_TOP_FRACTION = 0.17;

export default function ScreenshotMode({ onBack, backendUrl, onCaptured }) {
  // idle | listing | picking | capturing | processing
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [windows, setWindows] = useState([]);

  const supported = !!(
    window.electronAPI?.listCapturableWindows &&
    window.electronAPI?.captureScreenshot &&
    window.electronAPI?.recognizeText
  );

  // C (or Space) triggers the window picker; B returns to the menu —
  // mirroring CameraMode's shortcuts. B works in any state so you can always
  // back out.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onBack();
        return;
      }
      if (status !== 'idle') return;
      if (event.key === ' ' || event.key.toLowerCase() === 'c') {
        event.preventDefault();
        openPicker();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function openPicker() {
    if (!supported || status !== 'idle') return;

    setStatus('listing');
    setErrorMessage('');
    setPermissionDenied(false);

    let result;
    try {
      result = await window.electronAPI.listCapturableWindows();
    } catch (err) {
      setStatus('idle');
      setErrorMessage(err?.message || 'Could not list open windows.');
      return;
    }

    if (result.error) {
      setStatus('idle');
      setPermissionDenied(result.error === 'permission-denied');
      setErrorMessage(
        result.error === 'permission-denied'
          ? 'Brailliant needs Screen Recording permission to list and capture windows.'
          : result.error === 'unsupported-platform'
            ? 'Screenshot capture is only available in the desktop app on macOS.'
            : 'Could not list open windows.',
      );
      return;
    }

    setWindows(result.windows);
    setStatus('picking');
  }

  function cancelPicker() {
    setStatus('idle');
  }

  async function captureWindow(windowId) {
    setStatus('capturing');

    let result;
    try {
      result = await window.electronAPI.captureScreenshot({ windowId });
    } catch (err) {
      setStatus('idle');
      setErrorMessage(err?.message || 'Could not capture that window.');
      return;
    }

    if (result.canceled) {
      setStatus('idle');
      return;
    }

    if (result.error) {
      setStatus('idle');
      setPermissionDenied(result.error === 'permission-denied');
      setErrorMessage(
        result.error === 'permission-denied'
          ? 'Brailliant needs Screen Recording permission to capture that window.'
          : result.error === 'unsupported-platform'
            ? 'Screenshot capture is only available in the desktop app on macOS.'
            : result.message || 'Could not capture that window.',
      );
      return;
    }

    setStatus('processing');
    try {
      const text = await window.electronAPI.recognizeText(result.dataUrl, {
        excludeTopFraction: SCREENSHOT_CHROME_EXCLUDE_TOP_FRACTION,
      });

      const response = await fetch(`${backendUrl}/upload-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const data = await response.json();
      onCaptured(data);
    } catch (err) {
      setStatus('idle');
      setErrorMessage(err?.message || 'Could not read text from that window.');
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-4xl font-extrabold text-text">Screenshot Mode</h1>
        <p className="mt-2 max-w-md text-subtext">
          Press <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">C</kbd>{' '}
          to pick a window (e.g. your browser) to capture — the text will be read word by word and embossed live on
          the physical Braille display.
        </p>
      </div>

      {!supported && (
        <div className="flex w-full flex-col items-center gap-2 rounded-xl border-3 border-border bg-cardBg p-8 shadow-brutal">
          <p className="text-xl font-bold text-text">Screen capture unavailable</p>
          <p className="text-sm font-semibold text-subtext">
            This only works in the Brailliant desktop app on macOS.
          </p>
        </div>
      )}

      <div className="flex w-full flex-col items-center gap-2 rounded-xl border-3 border-border bg-cardBg p-4 shadow-brutal">
        <p className="text-sm font-extrabold uppercase tracking-widest text-text">
          {status === 'listing'
            ? 'Finding windows…'
            : status === 'picking'
              ? 'Choose a window…'
              : status === 'capturing'
                ? 'Capturing…'
                : status === 'processing'
                  ? 'Reading text…'
                  : 'Ready'}
        </p>
      </div>

      {errorMessage && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold text-subtext">{errorMessage}</p>
          {permissionDenied && (
            <button
              onClick={() => window.electronAPI.openScreenRecordingSettings()}
              className="rounded-xl border-3 border-border bg-cardBg px-4 py-2 text-sm font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
            >
              Open Screen Recording Settings
            </button>
          )}
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={openPicker}
          disabled={!supported || status !== 'idle'}
          className="inline-flex items-center gap-2 rounded-xl border-3 border-border bg-primary px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          Capture Screenshot
          <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">C</kbd>
        </button>

        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border-3 border-border bg-yellow px-6 py-3 text-lg font-bold text-text shadow-brutal transition-all active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
        >
          Back to Menu
          <kbd className="rounded-md border-3 border-border bg-cardBg px-2 py-0.5 text-sm font-extrabold">B</kbd>
        </button>
      </div>

      {status === 'picking' && <WindowPicker windows={windows} onSelect={captureWindow} onCancel={cancelPicker} />}
    </div>
  );
}
