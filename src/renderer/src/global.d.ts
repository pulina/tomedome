declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module '*.css';

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

interface ElectronAPI {
  getBackendPort(): Promise<number>;
  openFileDialog(): Promise<string | null>;
  readFileBytes(filePath: string): Promise<Uint8Array>;
  getPathForFile(file: File): string;
  platform: NodeJS.Platform;
}

interface Window {
  electronAPI: ElectronAPI;
}
