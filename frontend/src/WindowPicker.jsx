// WindowPicker.jsx
//
// Modal grid of currently open windows (from Electron's desktopCapturer via
// window.electronAPI.listCapturableWindows), rendered inside Brailliant's
// own UI so picking a window to screenshot never leaves the app or relies
// on macOS's own interactive screencapture picker. Click a window (or press
// Escape to cancel) to hand its id back to ScreenshotMode, which then
// captures that specific window non-interactively.

import { useEffect } from 'react';

export default function WindowPicker({ windows, onSelect, onCancel }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 rounded-xl border-3 border-border bg-bg p-6 shadow-brutal">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-extrabold text-text">Choose a Window</h2>
          <button
            onClick={onCancel}
            className="rounded-lg border-3 border-border bg-cardBg px-3 py-1 text-sm font-bold text-text shadow-brutal-sm transition-all active:translate-x-1 active:translate-y-1"
          >
            Cancel
            <kbd className="ml-2 rounded border-2 border-border bg-bg px-1">Esc</kbd>
          </button>
        </div>

        {windows.length === 0 ? (
          <p className="text-sm font-semibold text-subtext">No capturable windows found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 overflow-y-auto sm:grid-cols-3">
            {windows.map((win) => (
              <button
                key={win.id}
                onClick={() => onSelect(win.id)}
                className="flex flex-col items-center gap-2 rounded-xl border-3 border-border bg-cardBg p-3 shadow-brutal-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-brutal active:translate-x-1 active:translate-y-1 active:shadow-brutal-sm"
              >
                <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border-3 border-border bg-bg">
                  {win.thumbnailDataUrl ? (
                    <img src={win.thumbnailDataUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs font-semibold text-subtext">No preview</span>
                  )}
                </div>
                <span className="line-clamp-2 text-xs font-bold text-text">{win.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
