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
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEV_SERVER_URL = 'http://localhost:5173';
const OCR_HELPER_PATH = path.join(__dirname, 'native', 'ocr_helper');

// ---- Persistent Vision detector -----------------------------------------
//
// The live camera-guidance loop needs low-latency text detection many times a
// second. Spawning the helper (and cold-starting Vision) per frame was the
// reactivity bottleneck, so we keep ONE warm `ocr_helper --serve` process and
// stream frames to it: write a 4-byte big-endian length + JPEG bytes to its
// stdin, read back one JSON line of boxes per frame from its stdout. Requests
// are answered FIFO (the helper processes frames in order), and the renderer
// awaits each detect before sending the next, so at most one is in flight.
let detector = null; // { child, pending: resolver[], buffer: string }

function ensureDetector() {
  if (detector) return detector;

  const child = spawn(OCR_HELPER_PATH, ['--serve']);
  const state = { child, pending: [], buffer: '' };

  child.stdout.on('data', (chunk) => {
    state.buffer += chunk.toString();
    let nl;
    while ((nl = state.buffer.indexOf('\n')) >= 0) {
      const line = state.buffer.slice(0, nl);
      state.buffer = state.buffer.slice(nl + 1);
      const resolve = state.pending.shift();
      if (resolve) {
        try {
          resolve(JSON.parse(line || '[]'));
        } catch {
          resolve([]);
        }
      }
    }
  });
  child.stderr.on('data', (d) => console.error('[ocr --serve]', d.toString().trim()));
  child.on('exit', () => {
    // Fail any in-flight requests and drop the handle so the next call respawns.
    state.pending.forEach((resolve) => resolve([]));
    if (detector === state) detector = null;
  });

  detector = state;
  return state;
}

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

// Fast Vision pass for the live camera-guidance loop: returns an array of
// { text, confidence, x, y, w, h } (box in top-left-origin normalized coords)
// so the renderer can locate/track the text and gauge legibility several times
// a second. Streamed to the warm --serve process (no per-frame spawn or temp
// file) for low latency; the final capture still uses accurate recognize-text.
ipcMain.handle('detect-text', async (event, imageDataUrl) => {
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const frame = Buffer.from(base64, 'base64');
  const det = ensureDetector();

  return new Promise((resolve) => {
    det.pending.push(resolve);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(frame.length, 0);
    det.child.stdin.write(header);
    det.child.stdin.write(frame);
  });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Tear down the warm detector process when the app exits.
app.on('will-quit', () => {
  if (detector) {
    detector.child.kill();
    detector = null;
  }
});
