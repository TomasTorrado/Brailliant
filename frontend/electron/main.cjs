// electron/main.cjs
//
// Electron main process: opens the desktop window and hosts native bridges
// invoked by the renderer via the preload contextBridge — the PDF
// file-picker dialog, OCR via macOS's Vision framework (a compiled Swift CLI
// helper, since the renderer can't call native macOS APIs directly, see
// electron/native/ocr_helper.swift), and native screen capture via macOS's
// screencapture CLI for Screenshot Mode.
//
// In development it loads the Vite dev server (so HMR keeps working); once
// packaged, it loads the built static files from dist/.

const { app, BrowserWindow, ipcMain, dialog, systemPreferences, shell, desktopCapturer } = require('electron');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEV_SERVER_URL = 'http://localhost:5173';
const OCR_HELPER_PATH = path.join(__dirname, 'native', 'ocr_helper');

// Tracked so list-capturable-windows can exclude this app's own window from
// the picker (capturing Brailliant's own UI, mid-picker, would be useless).
let mainWindow = null;

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

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
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

// Runs OCR on an image via macOS's Vision framework. The renderer can't call
// native APIs directly, so this writes the image to a temp file, shells out
// to the compiled ocr_helper binary, and parses the JSON array of
// {text, top} lines it prints (top = that line's top edge as a fraction of
// image height, 0 = top of image).
//
// `excludeTopFraction` (optional) drops every line whose top falls above
// that fraction before joining the rest into plain text. Screenshot Mode
// passes this to cut out a maximized browser's chrome (tabs/address
// bar/bookmarks); Camera Mode does NOT pass it — a real-world photo has no
// "browser chrome" concept, and blindly stripping its top edge would just
// eat real content.
ipcMain.handle('recognize-text', async (event, imageDataUrl, options = {}) => {
  const { excludeTopFraction = 0 } = options;
  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const tempPath = path.join(os.tmpdir(), `braille-ocr-${crypto.randomUUID()}.png`);
  fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));

  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(OCR_HELPER_PATH, [tempPath], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });

    const lines = JSON.parse(stdout);
    return lines
      .filter((line) => line.top >= excludeTopFraction)
      .map((line) => line.text)
      .join('\n');
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

// Lists currently open windows (name + thumbnail) so Screenshot Mode can
// show an in-app picker instead of capturing blind. desktopCapturer's
// window source ids on macOS are formatted "window:<CGWindowID>:0" — we
// keep the full id around for the renderer, and capture-screenshot below
// pulls the numeric CGWindowID back out of it for `screencapture -l`.
ipcMain.handle('list-capturable-windows', async () => {
  if (process.platform !== 'darwin') {
    return { error: 'unsupported-platform' };
  }

  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    return { error: 'permission-denied' };
  }

  const ownSourceId = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getMediaSourceId() : null;

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 200 },
  });

  const windows = sources
    .filter((source) => source.id !== ownSourceId && source.name)
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnailDataUrl: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
    }));

  return { windows };
});

// Captures either the main display (-m, no windowId given) or one specific
// window (-l <windowid>) via macOS's screencapture CLI. Capturing a specific
// window grabs just that window's own compositing surface directly
// regardless of what's on top of or behind it, so — unlike the whole-display
// path — there's no need to hide our own window first.
const SCREENSHOT_HIDE_DELAY_MS = 200;

ipcMain.handle('capture-screenshot', async (event, options = {}) => {
  if (process.platform !== 'darwin') {
    return { error: 'unsupported-platform' };
  }

  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    return { error: 'permission-denied' };
  }

  const { windowId } = options;
  // desktopCapturer source ids look like "window:12345:0" — screencapture
  // -l wants just the numeric CGWindowID in the middle.
  const cgWindowId = windowId ? windowId.split(':')[1] : null;

  const win = BrowserWindow.fromWebContents(event.sender);
  const tempPath = path.join(os.tmpdir(), `braille-screenshot-${crypto.randomUUID()}.png`);

  if (!cgWindowId) {
    win?.hide();
    await new Promise((resolve) => setTimeout(resolve, SCREENSHOT_HIDE_DELAY_MS));
  }

  try {
    await new Promise((resolve, reject) => {
      const args = cgWindowId ? ['-l', cgWindowId, tempPath] : ['-m', tempPath];
      execFile('screencapture', args, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });
  } catch (err) {
    win?.show();
    // screencapture's own failure text isn't user-friendly and often names
    // an internal NSIRD_screencaptureui temp path rather than ours — but in
    // practice this only happens when Screen Recording permission isn't
    // actually granted to the calling process, even if our earlier
    // getMediaAccessStatus check said otherwise (TCC state can lag behind,
    // or the terminal launching `npm run dev` is a different identity than
    // whatever holds the grant). Re-check and reclassify.
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      return { error: 'permission-denied' };
    }
    return { error: 'capture-failed', message: err.message };
  }

  win?.show();

  // Neither path has an interactive step to cancel, so a missing file here
  // almost always means screencapture silently no-op'd due to a permission
  // grant that hasn't taken effect yet — check that before giving up.
  if (!fs.existsSync(tempPath)) {
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      return { error: 'permission-denied' };
    }
    return { canceled: true };
  }

  try {
    const buffer = fs.readFileSync(tempPath);
    return { dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

ipcMain.handle('open-screen-recording-settings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
