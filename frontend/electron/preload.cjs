// electron/preload.cjs
//
// Exposes a minimal, explicit API to the renderer via contextBridge so it
// can trigger the native PDF file-picker dialog instead of a browser
// <input type="file">, without giving the renderer direct Node/IPC access.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openPDFDialog: () => ipcRenderer.invoke('open-pdf-dialog'),
});
