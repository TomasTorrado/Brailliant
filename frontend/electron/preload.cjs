// electron/preload.cjs
//
// Exposes a minimal, explicit API to the renderer via contextBridge so it
// can trigger native features — the PDF file-picker dialog, and OCR via
// macOS's Vision framework — without giving the renderer direct Node/IPC
// access.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDFDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
  recognizeText: (imageDataUrl) => ipcRenderer.invoke('recognize-text', imageDataUrl),
});
