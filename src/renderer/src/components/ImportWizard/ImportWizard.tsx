import { DragEvent, useEffect, useRef, useState } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { bookApi, type ZipImportSource } from '../../api/book-api';
import { seriesApi } from '../../api/series-api';
import type { ImportResult, Series } from '../../../../shared/types';
import { resolveDroppedFilePath } from '../../utils/dndFilePath';
import styles from './ImportWizard.module.css';

function isZipFilename(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

interface Props {
  onClose: () => void;
  onDone: (result: ImportResult) => void;
}

type Step = 'drop' | 'series-pick' | 'importing';

export function ImportWizard({ onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('drop');
  const [dragHighlight, setDragHighlight] = useState(false);
  const dragDepth = useRef(0);
  const [zipSource, setZipSource] = useState<ZipImportSource | null>(null);
  const [peekedTitle, setPeekedTitle] = useState('');
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peeking, setPeeking] = useState(false);

  // series-pick step
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [seriesLoading, setSeriesLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(modalRef);

  useEffect(() => {
    if (step === 'series-pick') {
      setSeriesLoading(true);
      seriesApi.list().then((list) => {
        setSeriesList(list);
        const head = list[0];
        if (head) setSelectedSeriesId(head.id);
        else setCreatingNew(true);
        setSeriesLoading(false);
      });
    }
  }, [step]);

  async function runPeek(src: ZipImportSource) {
    setZipSource(src);
    setPeekError(null);
    setPeeking(true);
    try {
      const peek = await bookApi.peekZipSource(src);
      setPeekedTitle(peek.seriesTitle);
      if (peek.type === 'book') {
        setNewSeriesTitle(peek.seriesTitle);
        setStep('series-pick');
      } else {
        await doImport(src, undefined);
      }
    } catch (err) {
      setPeekError(err instanceof Error ? err.message : 'Failed to read archive');
    } finally {
      setPeeking(false);
    }
  }

  async function handlePickedFile(f: File) {
    if (!f.name.endsWith('.zip')) {
      setPeekError('Only .zip files are supported.');
      return;
    }
    await runPeek({ kind: 'file', file: f });
  }

  async function handlePickedPath(path: string) {
    if (!path.toLowerCase().endsWith('.zip')) {
      setPeekError('Only .zip files are supported.');
      return;
    }
    await runPeek({ kind: 'path', path });
  }

  async function doImport(src: ZipImportSource, seriesId: string | undefined) {
    setStep('importing');
    const result = await bookApi.importZipSource(src, seriesId);
    onDone(result);
  }

  async function handleSeriesConfirm() {
    if (!zipSource) return;
    try {
      let seriesId = selectedSeriesId ?? undefined;
      if (creatingNew) {
        if (!newSeriesTitle.trim()) return;
        const created = await seriesApi.create(newSeriesTitle.trim());
        seriesId = created.id;
      }
      await doImport(zipSource, seriesId);
    } catch (err) {
      setPeekError(err instanceof Error ? err.message : 'Import failed');
      setStep('drop');
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragHighlight(false);
    const resolved = resolveDroppedFilePath(e, isZipFilename);
    if (resolved) {
      void handlePickedPath(resolved);
      return;
    }
    const f = e.dataTransfer.files[0];
    if (f) void handlePickedFile(f);
  }

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
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  const STEP_LABELS: Record<Step, string> = {
    'drop': 'Import',
    'series-pick': 'Choose series',
    'importing': 'Importing…',
  };

  const canConfirmSeries = creatingNew ? !!newSeriesTitle.trim() : !!selectedSeriesId;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.title}>{STEP_LABELS[step]}</span>
          {peekedTitle && step === 'series-pick' && (
            <span className={styles.subtitle}>{peekedTitle}</span>
          )}
        </div>

        <div className={styles.body}>
          {step === 'drop' && (
            <>
              <div
                className={`${styles.dropZone} ${dragHighlight ? styles.dropZoneDragOver : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={styles.dropZoneLabel}>
                  {peeking ? 'Reading archive…' : 'Drop a .zip export here'}
                </div>
                <div className={styles.dropZoneHint}>or click to browse</div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handlePickedFile(f);
                }}
              />
              {peekError && <div className={styles.errorText}>{peekError}</div>}
            </>
          )}

          {step === 'series-pick' && (
            seriesLoading
              ? <div className={styles.loadingText}>Loading series…</div>
              : (
                <>
                  {seriesList.length > 0 && !creatingNew && (
                    <div className={styles.seriesList}>
                      {seriesList.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`${styles.seriesItem} ${selectedSeriesId === s.id ? styles.seriesItemSelected : ''}`}
                          onClick={() => setSelectedSeriesId(s.id)}
                        >
                          <span className={styles.seriesName}>{s.title}</span>
                          <span className={styles.seriesMeta}>{s.bookCount} {s.bookCount === 1 ? 'volume' : 'volumes'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {creatingNew ? (
                    <div className={styles.newSeriesRow}>
                      <input
                        className={styles.input}
                        placeholder="Series title…"
                        value={newSeriesTitle}
                        onChange={(e) => setNewSeriesTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && canConfirmSeries && void handleSeriesConfirm()}
                        autoFocus
                      />
                      {seriesList.length > 0 && (
                        <button className={styles.btn} onClick={() => setCreatingNew(false)}>Cancel</button>
                      )}
                    </div>
                  ) : (
                    <button className={styles.newSeriesBtn} onClick={() => setCreatingNew(true)}>
                      ⊕ New series
                    </button>
                  )}
                </>
              )
          )}

          {step === 'importing' && (
            <div className={styles.loadingText}>Importing…</div>
          )}
        </div>

        <div className={styles.footer}>
          {step === 'drop' && (
            <button className={styles.btn} onClick={onClose}>Cancel</button>
          )}
          {step === 'series-pick' && (
            <>
              <button
                className={styles.btn}
                onClick={() => {
                  setStep('drop');
                  setPeekError(null);
                  setZipSource(null);
                }}
              >
                Back
              </button>
              <button className={styles.btn} onClick={onClose}>Cancel</button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!canConfirmSeries}
                onClick={() => void handleSeriesConfirm()}
              >
                Import
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
