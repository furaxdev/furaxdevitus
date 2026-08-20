const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// electron-store for secure local storage
let store;

async function initStore() {
  const Store = (await import('electron-store')).default;
  store = new Store({
    encryptionKey: 'cours-notes-secure-key-2024',
    schema: {
      apiKey: { type: 'string', default: '' },
      windowBounds: {
        type: 'object',
        default: { width: 1200, height: 800 }
      }
    }
  });
}

function getNotesDir() {
  const notesDir = path.join(app.getPath('userData'), 'notes');
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }
  return notesDir;
}

let mainWindow;

async function createWindow() {
  await initStore();

  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('resize', () => {
    const { width, height } = mainWindow.getBounds();
    store.set('windowBounds', { width, height });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC Handlers

ipcMain.handle('get-api-key', () => {
  return store ? store.get('apiKey', '') : '';
});

ipcMain.handle('save-api-key', (_, key) => {
  if (store) store.set('apiKey', key);
  return true;
});

ipcMain.handle('list-notes', () => {
  const notesDir = getNotesDir();
  try {
    const files = fs.readdirSync(notesDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = path.join(notesDir, f);
        const stat = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          mtime: stat.mtime.toISOString(),
          size: stat.size
        };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    return files;
  } catch {
    return [];
  }
});

ipcMain.handle('read-note', (_, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
});

ipcMain.handle('save-note', (_, { filename, content }) => {
  const notesDir = getNotesDir();
  const safeFilename = filename
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .substring(0, 100);
  const finalName = safeFilename.endsWith('.md') ? safeFilename : `${safeFilename}.md`;
  const filePath = path.join(notesDir, finalName);
  fs.writeFileSync(filePath, content, 'utf-8');
  return { success: true, path: filePath, name: finalName };
});

ipcMain.handle('delete-note', (_, filePath) => {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('show-notes-folder', () => {
  shell.openPath(getNotesDir());
});

ipcMain.handle('get-notes-dir', () => {
  return getNotesDir();
});
