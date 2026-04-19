import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { setApplicationMenu } from './application-menu';
import { getLogger } from './lib/logger';
import { addSessionAllowedReadPath, resolveAllowedReadPath } from './lib/read-path-policy';
import { getDb, closeDb } from './services/database';
import { startServer, StartedServer } from './server';

app.setName('TomeDome');

const MAX_IMPORT_ZIP_BYTES = 512 * 1024 * 1024;

let serverHandle: StartedServer | undefined;
let mainWindow: BrowserWindow | undefined;

function registerProcessErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    try {
      getLogger().error({ err }, 'uncaughtException');
    } catch {
      console.error('uncaughtException', err);
    }
  });
  process.on('unhandledRejection', (reason) => {
    try {
      getLogger().error({ err: reason }, 'unhandledRejection');
    } catch {
      console.error('unhandledRejection', reason);
    }
  });
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0B0B0F',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        void shell.openExternal(url);
      }
    } catch {
      /* ignore invalid URL */
    }
    return { action: 'deny' };
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererDir = resolve(__dirname, '../renderer');

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (devServerUrl) {
      try {
        if (new URL(navigationUrl).origin === new URL(devServerUrl).origin) {
          return;
        }
      } catch {
        /* invalid URL */
      }
      event.preventDefault();
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(navigationUrl);
    } catch {
      event.preventDefault();
      return;
    }
    if (parsed.protocol !== 'file:') {
      event.preventDefault();
      return;
    }
    try {
      const targetPath = fileURLToPath(navigationUrl);
      const rel = relative(rendererDir, targetPath);
      if (rel.startsWith('..')) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow = win;
  win.on('closed', () => {
    mainWindow = undefined;
  });
}

async function bootstrap(): Promise<void> {
  registerProcessErrorHandlers();
  const log = getLogger();

  setApplicationMenu();

  // Initialise DB up front so early config reads work
  getDb();

  serverHandle = await startServer();

  ipcMain.handle('get-backend-port', () => serverHandle?.port ?? 0);

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Books', extensions: ['txt', 'md', 'epub'] }],
    });
    if (result.canceled) return null;
    const chosen = result.filePaths[0];
    if (!chosen) return null;
    try {
      addSessionAllowedReadPath(await realpath(chosen));
    } catch {
      /* path may be gone; read-file-bytes will still validate roots */
    }
    return chosen;
  });

  ipcMain.handle('read-file-bytes', async (_evt, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      throw new Error('Invalid path');
    }
    const p = await resolveAllowedReadPath(rawPath);
    const st = await stat(p);
    if (!st.isFile()) throw new Error('Not a file');
    if (st.size > MAX_IMPORT_ZIP_BYTES) throw new Error('File too large');
    const buf = await readFile(p);
    return new Uint8Array(buf);
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  log.info('TomeDome bootstrap complete');
}

app.whenReady().then(bootstrap).catch((err) => {
  getLogger().error({ err }, 'fatal bootstrap failure');
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try {
    if (serverHandle) await serverHandle.fastify.close();
  } catch (err) {
    getLogger().error({ err }, 'error closing fastify');
  }
  closeDb();
});
