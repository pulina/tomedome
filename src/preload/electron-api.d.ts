import type { ElectronAPI } from './index';

/**
 * Preload surface (`contextBridge.exposeInMainWorld('electronAPI', …)`).
 *
 * IPC: `get-backend-port`, `open-file-dialog`, `read-file-bytes` — see `src/main/index.ts`.
 * No IPC: `getPathForFile` (Chromium `webUtils`), `platform` (snapshot of `process.platform`).
 */

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
