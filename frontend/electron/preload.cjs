// electron/preload.cjs
//
// Exposes a minimal, explicit API to the renderer via contextBridge so it
// can trigger native features — the PDF file-picker dialog, OCR via macOS's
// Vision framework, native screen capture, and the live camera-guidance
// detector — without giving the renderer direct Node/IPC access.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDFDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
  recognizeText: (imageDataUrl, options) => ipcRenderer.invoke('recognize-text', imageDataUrl, options),
  // Fast Vision pass for live camera guidance: returns [{ text, confidence, x, y, w, h }].
  detectText: (imageDataUrl) => ipcRenderer.invoke('detect-text', imageDataUrl),
  listCapturableWindows: () => ipcRenderer.invoke('list-capturable-windows'),
  captureScreenshot: (options) => ipcRenderer.invoke('capture-screenshot', options),
  openScreenRecordingSettings: () => ipcRenderer.invoke('open-screen-recording-settings'),
});
