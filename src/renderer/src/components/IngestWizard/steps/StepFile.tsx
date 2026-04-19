import { DragEvent, LegacyRef, RefObject, useRef, useState } from 'react';
import styles from '../IngestWizard.module.css';

interface Props {
  filePath: string | null;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onBrowse: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInput: (path: string) => void;
}

export function StepFile({
  filePath,
  onDrop,
  onBrowse,
  fileInputRef,
  onFileInput,
}: Props) {
  const [dragHighlight, setDragHighlight] = useState(false);
  const dragDepth = useRef(0);

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    dragDepth.current += 1;
    if (dragDepth.current === 1) setDragHighlight(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragHighlight(false);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    dragDepth.current = 0;
    setDragHighlight(false);
    onDrop(e);
  }

  return (
    <>
      <div
        className={`${styles.dropZone} ${dragHighlight ? styles.dropZoneDragOver : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onBrowse}
      >
        <div className={styles.dropZoneLabel}>Drop a .txt, .md, or .epub file here</div>
        <div className={styles.dropZoneHint}>or click to browse</div>
      </div>
      <input
        ref={fileInputRef as LegacyRef<HTMLInputElement>}
        type="file"
        accept=".txt,.md,.epub"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const extended = f as File & { path?: string };
          let path: string | null =
            typeof extended.path === 'string' && extended.path.length > 0 ? extended.path : null;
          if (!path) {
            try {
              const p = window.electronAPI.getPathForFile(f);
              path = p.length > 0 ? p : null;
            } catch {
              path = null;
            }
          }
          if (path) onFileInput(path);
        }}
      />
      {filePath && <div className={styles.selectedFile}>{filePath}</div>}
    </>
  );
}
