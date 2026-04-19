import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { version } from '../../package.json';

const api = {
  getBackendPort: (): Promise<number> => ipcRenderer.invoke('get-backend-port'),
  openFileDialog: (): Promise<string | null> => ipcRenderer.invoke('open-file-dialog'),
  readFileBytes: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('read-file-bytes', filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  platform: process.platform,
  appVersion: version,
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
