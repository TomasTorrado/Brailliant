// electron/main.cjs
//
// Electron main process: opens the desktop window and hosts native bridges
// invoked by the renderer via the preload contextBridge — the PDF
// file-picker dialog, and OCR via macOS's Vision framework (a compiled
// Swift CLI helper, since the renderer can't call native macOS APIs
// directly). See electron/native/ocr_helper.swift.
//
// In development it loads the Vite dev server (so HMR keeps working); once
// packaged, it loads the built static files from dist/.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEV_SERVER_URL = 'http://localhost:5173';
const OCR_HELPER_PATH = path.join(__dirname, 'native', 'ocr_helper');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    win.loadURL(DEV_SERVER_URL);
  }
}

ipcMain.handle('open-pdf-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });

  if (canceled || !filePaths.length) return null;

  const filePath = filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return {
    name: path.basename(filePath),
    data: Uint8Array.from(buffer),
  };
});

// Runs OCR on a captured camera frame via macOS's Vision framework. The
// renderer can't call native APIs directly, so this writes the frame to a
// temp file, shells out to the compiled ocr_helper binary, and returns
// whatever text it printed to stdout.
ipcMain.handle('recognize-text', async (event, imageDataUrl) => {
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const tempPath = path.join(os.tmpdir(), `braille-ocr-${crypto.randomUUID()}.png`);
  fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));

  try {
    return await new Promise((resolve, reject) => {
      execFile(OCR_HELPER_PATH, [tempPath], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
