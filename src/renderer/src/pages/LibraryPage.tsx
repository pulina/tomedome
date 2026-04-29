import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLocation } from 'react-router-dom';
import { ApiError } from '../api/api-error';
import { bookApi } from '../api/book-api';
import { configApi } from '../api/config-api';
import { jobApi } from '../api/job-api';
import { seriesApi } from '../api/series-api';
import { IngestWizard } from '../components/IngestWizard/IngestWizard';
import { AbstractsModal } from '../components/AbstractsModal/AbstractsModal';
import { EmbeddingsInspector } from '../components/EmbeddingsInspector/EmbeddingsInspector';
import { ExportModal } from '../components/ExportModal/ExportModal';
import { ImportWizard } from '../components/ImportWizard/ImportWizard';
import { useSelectedSeries } from '../hooks/useSelectedSeries';
import { useJobs } from '../hooks/useJobs';
import type { Book, ImportResult, Job, JobType, Series } from '../../../shared/types';
import {
  bookEmbeddingProfileMismatch,
  bookStoredEmbeddingProfileDiffers,
  embeddingOverrideActive,
  normalizeEmbeddingPrefix,
} from '@shared/embedding-profile';
import styles from './LibraryPage.module.css';

/** RAG needs a configured embedding model; without it we treat retrieval as off even if rows still list vectors. */
function bookHasRag(book: Book, currentEmbeddingModel: string | null, currentPassagePrefix: string): boolean {
  if (!book.embeddedAt || book.chunkCount === 0) return false;
  if (embeddingOverrideActive(book, currentEmbeddingModel, currentPassagePrefix)) return true;
  if (!(currentEmbeddingModel ?? '').trim()) return false;
  return !bookStoredEmbeddingProfileDiffers(book, currentEmbeddingModel, currentPassagePrefix);
}

export function LibraryPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [abstractsBookId, setAbstractsBookId] = useState<string | null>(null);
  const [inspectorBookId, setInspectorBookId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [regeneratingSeries, setRegeneratingSeries] = useState<string | null>(null);
  const [deletingSeries, setDeletingSeries] = useState<string | null>(null);
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [editingSeriesTitle, setEditingSeriesTitle] = useState('');
  const [exportTarget, setExportTarget] = useState<{ kind: 'series' | 'book'; id: string; title: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [currentEmbeddingModel, setCurrentEmbeddingModel] = useState<string | null>(null);
  const [currentEmbeddingPassagePrefix, setCurrentEmbeddingPassagePrefix] = useState('');

  const { selectedSeriesId, refresh: refreshSeries } = useSelectedSeries();
  const { jobs } = useJobs();
  const sseCloseRef = useRef<(() => void) | null>(null);
  const location = useLocation();

  // Jobs arrive newest-first. Record the latest job per (bookId, type), then show
  // a "continue" button only when that latest run actually errored AND the book's
  // own abstractedAt / embeddedAt hasn't been updated since — which would mean a
  // later job (e.g. "Embeddings + abstracts") already completed the work.
  const latestJobByBookType = new Map<string, Job>();
  for (const job of jobs) {
    const key = `${job.bookId}:${job.type}`;
    if (!latestJobByBookType.has(key)) latestJobByBookType.set(key, job);
  }
  const erroredJobByBook = new Map<string, JobType>();
  for (const job of latestJobByBookType.values()) {
    if (job.status !== 'error' || !job.bookId) continue;
    const book = books.find((b) => b.id === job.bookId);
    if (!book) continue;
    // If the book's relevant timestamp is newer than the job error, the work was
    // completed by another run — don't offer resume.
    const successAt =
      job.type === 'abstract_generation' ? book.abstractedAt : book.embeddedAt;
    if (successAt && successAt > job.updatedAt) continue;
    erroredJobByBook.set(job.bookId, job.type);
  }

  const load = useCallback(async () => {
    const [list, series, cfg] = await Promise.all([
      bookApi.list(),
      seriesApi.list(),
      configApi.getLlmConfig().catch((): null => null),
    ]);
    setBooks(list);
    setSeriesList(series);
    if (cfg) {
      const em = (cfg.embeddingModel ?? '').trim();
      setCurrentEmbeddingModel(em.length > 0 ? em : null);
      setCurrentEmbeddingPassagePrefix(cfg.embeddingPassagePrefix ?? '');
    }
  }, []);

  useEffect(() => {
    if (location.pathname === '/library') {
      void load();
    }
  }, [location.pathname, load]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || location.pathname !== '/library') return;
      void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [load, location.pathname]);

  useEffect(() => {
    let cancelled = false;
    jobApi.openStream((job) => {
      if (
        !cancelled &&
        (job.status === 'done' || job.status === 'error') &&
        (job.type === 'abstract_generation' || job.type === 'embedding_generation')
      ) {
        void load();
      }
    }).then((close) => {
      if (cancelled) close();
      else sseCloseRef.current = close;
    });

    return () => {
      cancelled = true;
      sseCloseRef.current?.();
      sseCloseRef.current = null;
    };
  }, [load]);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await bookApi.remove(id);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  async function handleResumeJob(bookId: string, type: JobType) {
    try {
      await bookApi.enqueueJob(bookId, type, { resume: true });
      void load();
    } catch (e) {
      if (e instanceof ApiError) window.alert(e.message);
      else throw e;
    }
  }

  async function handleEnqueueJob(bookId: string, type: 'abstract_generation' | 'embedding_generation') {
    if (type === 'abstract_generation') {
      const book = books.find((b) => b.id === bookId);
      if (
        book &&
        book.chunkCount > 0 &&
        book.embeddedAt &&
        bookStoredEmbeddingProfileDiffers(book, currentEmbeddingModel, currentEmbeddingPassagePrefix)
      ) {
        const ok = window.confirm(
          'Chunk vectors for this volume were built with a different embedding model or passage prefix than your current settings. ' +
            'Regenerating abstracts would embed summaries under the new profile while chunk vectors stay on the old one — semantic search assumes one profile per volume.\n\n' +
            'Proceed? This queues volume embedding (rebuild chunk vectors to match settings), then full abstract regeneration (new summary text and abstract embeddings).\n\n' +
            'Cancel = do nothing.',
        );
        if (ok) {
          try {
            await bookApi.enqueueJob(bookId, 'embedding_generation', { chainAbstractGeneration: true });
            void load();
          } catch (e) {
            if (e instanceof ApiError) window.alert(e.message);
            else throw e;
          }
        }
        return;
      }
    }
    try {
      await bookApi.enqueueJob(bookId, type);
      void load();
    } catch (e) {
      if (e instanceof ApiError) window.alert(e.message);
      else throw e;
    }
  }

  async function handleUpdateBook(
    bookId: string,
    patch: {
      title?: string;
      author?: string | null;
      year?: number | null;
      genre?: string | null;
      language?: string | null;
    },
  ) {
    const updated = await bookApi.update(bookId, patch);
    setBooks((prev) => {
      const mapped = prev.map((b) => (b.id === bookId ? updated : b));
      return [...mapped].sort((a, b) => {
        if (a.seriesId !== b.seriesId) return 0;
        return (a.seriesOrder ?? 999999) - (b.seriesOrder ?? 999999);
      });
    });
  }

  async function handleReorderSeries(seriesId: string, bookIds: string[]) {
    try {
      await seriesApi.setBookOrder(seriesId, bookIds);
      setBooks((prev) =>
        [...prev]
          .map((b) => {
            if (b.seriesId !== seriesId) return b;
            const idx = bookIds.indexOf(b.id);
            if (idx < 0) return b;
            return { ...b, seriesOrder: idx + 1 };
          })
          .sort((a, b) => {
            if (a.seriesId !== b.seriesId) return 0;
            return (a.seriesOrder ?? 999999) - (b.seriesOrder ?? 999999);
          }),
      );
    } catch (e) {
      if (e instanceof ApiError) window.alert(e.message);
      void load();
    }
  }

  async function handleSetEmbeddingOverride(bookId: string, override: boolean) {
    await bookApi.setEmbeddingOverride(bookId, override);
    await load();
  }

  async function handleRenameSeries(seriesId: string) {
    const title = editingSeriesTitle.trim();
    setEditingSeriesId(null);
    if (!title) return;
    const current = seriesList.find((s) => s.id === seriesId);
    if (title === current?.title) return;
    const updated = await seriesApi.rename(seriesId, title);
    setSeriesList((prev) => prev.map((s) => (s.id === seriesId ? updated : s)));
    void refreshSeries();
  }

  async function handleDeleteSeries(seriesId: string, bookCount: number) {
    const msg = bookCount > 0
      ? `Delete series? Its ${bookCount} book${bookCount !== 1 ? 's' : ''} will remain in the library without a series.`
      : 'Delete this series?';
    if (!window.confirm(msg)) return;
    setDeletingSeries(seriesId);
    try {
      await seriesApi.remove(seriesId);
      setSeriesList((prev) => prev.filter((s) => s.id !== seriesId));
      void refreshSeries();
    } finally {
      setDeletingSeries(null);
    }
  }

  async function handleRegenerateSeriesAbstract(seriesId: string) {
    setRegeneratingSeries(seriesId);
    try {
      const result = await seriesApi.regenerateAbstract(seriesId);
      setSeriesList((prev) =>
        prev.map((s) =>
          s.id === seriesId
            ? { ...s, abstract: result.abstract ?? undefined, abstractedAt: result.abstractedAt ?? undefined }
            : s,
        ),
      );
    } finally {
      setRegeneratingSeries(null);
    }
  }

  async function handleExport(includeEmbeddings: boolean) {
    if (!exportTarget) return;
    setExportTarget(null);
    setExporting(true);
    try {
      if (exportTarget.kind === 'series') {
        await bookApi.exportSeries(exportTarget.id, includeEmbeddings);
      } else {
        await bookApi.exportBook(exportTarget.id, includeEmbeddings);
      }
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  }


  const filtered = (!showAll && selectedSeriesId)
    ? books.filter((b) => b.seriesId === selectedSeriesId)
    : books;

  const seriesGroups: { seriesId: string; seriesTitle: string; books: Book[] }[] = [];
  for (const book of filtered) {
    const group = seriesGroups.find((g) => g.seriesId === book.seriesId);
    if (group) {
      group.books.push(book);
    } else {
      seriesGroups.push({ seriesId: book.seriesId, seriesTitle: book.seriesTitle, books: [book] });
    }
  }
  for (const g of seriesGroups) {
    g.books.sort((a, b) => (a.seriesOrder ?? 999999) - (b.seriesOrder ?? 999999));
  }

  const abstractsBook = books.find((b) => b.id === abstractsBookId);
  const inspectorBook = books.find((b) => b.id === inspectorBookId);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.heading}>Library</span>
        <div className={styles.toolbarRight}>
          {selectedSeriesId && (
            <label className={styles.showAllLabel}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              All series
            </label>
          )}
          {selectedSeriesId && !showAll && (
            <button
              className={styles.addBtn}
              disabled={exporting}
              onClick={() => {
                const s = seriesList.find((s) => s.id === selectedSeriesId);
                setExportTarget({ kind: 'series', id: selectedSeriesId, title: s?.title ?? 'Series' });
              }}
            >
              {exporting ? '… exporting' : '⬇ Export'}
            </button>
          )}
          <button
            className={styles.addBtn}
            onClick={() => setImportWizardOpen(true)}
          >
            ↑ Import
          </button>
          <button className={styles.addBtn} onClick={() => setWizardOpen(true)}>
            ⊕ Add Book
          </button>
        </div>
      </div>

      {importResult && (
        <div className={styles.importBanner}>
          <span>
            Imported <strong>{importResult.books.length}</strong> book
            {importResult.books.length !== 1 ? 's' : ''} into &quot;{importResult.seriesTitle}&quot;
            {importResult.schemaWarning && ` · ⚠ ${importResult.schemaWarning}`}
          </span>
          {importResult.books.filter((b) => b.warning).map((b) => (
            <div key={b.id} className={styles.importBannerWarning}>⚠ {b.title}: {b.warning}</div>
          ))}
          <button className={styles.importBannerClose} onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {filtered.length === 0 && books.length > 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No books in this series.</div>
          <div className={styles.emptyHint}>Select a different series or add a book.</div>
          <button
            className={styles.addBtnLarge}
            style={{ marginTop: 8 }}
            disabled={deletingSeries === selectedSeriesId}
            onClick={() => void handleDeleteSeries(selectedSeriesId!, 0)}
          >
            {deletingSeries === selectedSeriesId ? '…' : '✕ Delete series'}
          </button>
        </div>
      ) : books.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>No volumes inscribed yet.</div>
          <div className={styles.emptyHint}>Add your first book to begin processing.</div>
          <button className={styles.addBtnLarge} onClick={() => setWizardOpen(true)}>
            ⊕ Add Book
          </button>
        </div>
      ) : (
        <div className={styles.content}>
          {seriesGroups.map((group) => {
            const seriesData = seriesList.find((s) => s.id === group.seriesId);
            const isRegenerating = regeneratingSeries === group.seriesId;
            const isDeletingSeries = deletingSeries === group.seriesId;
            const volCount = group.books.length;
            const abstractHave = group.books.filter((b) => !!b.abstractedAt).length;
            const needRag = group.books.filter((b) => b.chunkCount > 0);
            const ragHave = needRag.filter((b) =>
              bookHasRag(b, currentEmbeddingModel, currentEmbeddingPassagePrefix),
            );
            const absStrike = volCount > 0 && abstractHave === 0;
            const absWarn = abstractHave > 0 && abstractHave < volCount;
            const ragEligible = needRag.length;
            const ragMissingCount = ragEligible - ragHave.length;
            const ragStrike =
              ragEligible === 0 || (ragEligible > 0 && ragHave.length === 0);
            const ragWarn =
              ragEligible > 0 &&
              ragMissingCount > 0 &&
              (ragMissingCount < ragEligible || ragEligible > 1);
            return (
              <div key={group.seriesId} className={styles.seriesSection}>
                <div className={styles.seriesHeader}>
                  {editingSeriesId === group.seriesId ? (
                    <input
                      className={styles.seriesTitleInput}
                      value={editingSeriesTitle}
                      autoFocus
                      onChange={(e) => setEditingSeriesTitle(e.target.value)}
                      onBlur={() => void handleRenameSeries(group.seriesId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void handleRenameSeries(group.seriesId); }
                        if (e.key === 'Escape') setEditingSeriesId(null);
                      }}
                    />
                  ) : (
                    <span
                      className={styles.seriesTitle}
                      title="Click to rename"
                      onClick={() => { setEditingSeriesId(group.seriesId); setEditingSeriesTitle(seriesData?.title ?? group.seriesTitle); }}
                    >
                      {seriesData?.title ?? group.seriesTitle}
                    </span>
                  )}
                  {volCount > 0 && (
                    <span className={styles.seriesCoverage} title="Book-level abstracts and RAG across volumes in this series">
                      <span className={absStrike ? styles.featureStruck : ''}>Abstracts</span>
                      {absWarn && (
                        <span className={styles.coverageWarn} aria-label="Some volumes missing abstracts">
                          <CoverageWarnGlyph />
                        </span>
                      )}
                      <span className={styles.featureSep} aria-hidden>
                        ·
                      </span>
                      <span className={ragStrike ? styles.featureStruck : ''}>RAG</span>
                      {ragWarn && (
                        <span className={styles.coverageWarn} aria-label="Some volumes missing embeddings or RAG">
                          <CoverageWarnGlyph />
                        </span>
                      )}
                    </span>
                  )}
                  <button
                    className={styles.seriesAbstractBtn}
                    onClick={() => {
                      if (seriesData?.abstract && !window.confirm('Regenerate series overview? The existing abstract will be replaced.')) return;
                      handleRegenerateSeriesAbstract(group.seriesId);
                    }}
                    disabled={isRegenerating}
                    title={seriesData?.abstract ? 'Regenerate series overview' : 'Generate series overview'}
                  >
                    {isRegenerating ? '…' : seriesData?.abstract ? '↺' : '⊕'}
                  </button>
                  <button
                    className={styles.seriesDeleteBtn}
                    onClick={() => handleDeleteSeries(group.seriesId, volCount)}
                    disabled={isDeletingSeries}
                    title="Delete series"
                  >
                    {isDeletingSeries ? '…' : '✕'}
                  </button>
                </div>
                {seriesData?.abstract && (
                  <p className={styles.seriesAbstract}>{seriesData.abstract}</p>
                )}
                <SeriesBookGrid
                  seriesId={group.seriesId}
                  books={group.books}
                  volCount={volCount}
                  onReorder={handleReorderSeries}
                  getBookCardExtras={(book) => ({
                    bookHasRag: bookHasRag(book, currentEmbeddingModel, currentEmbeddingPassagePrefix),
                    currentEmbeddingModel,
                    currentEmbeddingPassagePrefix,
                    deleting: deleting === book.id,
                    erroredJobType: erroredJobByBook.get(book.id),
                    onDelete: () => handleDelete(book.id),
                    onViewAbstracts: () => setAbstractsBookId(book.id),
                    onRetryAbstracts: () => handleEnqueueJob(book.id, 'abstract_generation'),
                    onRetryEmbedding: () => handleEnqueueJob(book.id, 'embedding_generation'),
                    onResumeJob: (type) => void handleResumeJob(book.id, type),
                    onInspectEmbeddings: () => setInspectorBookId(book.id),
                    onExport: () => setExportTarget({ kind: 'book', id: book.id, title: book.title }),
                    onSetEmbeddingOverride: (v) => void handleSetEmbeddingOverride(book.id, v),
                    onUpdate: (patch) => handleUpdateBook(book.id, patch),
                  })}
                />
              </div>
            );
          })}
        </div>
      )}

      {wizardOpen && (
        <IngestWizard
          initialSeriesId={selectedSeriesId ?? undefined}
          onClose={() => setWizardOpen(false)}
          onDone={() => {
            setWizardOpen(false);
            void load();
            void refreshSeries();
          }}
        />
      )}

      {abstractsBookId && abstractsBook && (
        <AbstractsModal
          bookId={abstractsBookId}
          bookTitle={abstractsBook.title}
          onClose={() => setAbstractsBookId(null)}
        />
      )}

      {inspectorBookId && inspectorBook && (
        <EmbeddingsInspector
          bookId={inspectorBookId}
          bookTitle={inspectorBook.title}
          bookEmbeddingModel={inspectorBook.embeddingModel}
          bookEmbeddingPassagePrefixSnapshot={inspectorBook.embeddingPassagePrefixSnapshot}
          bookEmbeddedAt={inspectorBook.embeddedAt}
          bookChunkCount={inspectorBook.chunkCount}
          currentEmbeddingModel={currentEmbeddingModel}
          currentEmbeddingPassagePrefix={currentEmbeddingPassagePrefix}
          embeddingModelOverride={inspectorBook.embeddingModelOverride}
          embeddingOverrideLockModel={inspectorBook.embeddingOverrideLockModel}
          embeddingOverrideLockPassagePrefix={inspectorBook.embeddingOverrideLockPassagePrefix}
          onClose={() => setInspectorBookId(null)}
          onSetEmbeddingOverride={(v) => void handleSetEmbeddingOverride(inspectorBookId, v)}
        />
      )}

      {exportTarget && (
        <ExportModal
          title={exportTarget.title}
          onConfirm={handleExport}
          onClose={() => setExportTarget(null)}
        />
      )}

      {importWizardOpen && (
        <ImportWizard
          onClose={() => setImportWizardOpen(false)}
          onDone={(result) => {
            setImportWizardOpen(false);
            setImportResult(result);
            void load();
            void refreshSeries();
          }}
        />
      )}
    </div>
  );
}

function CoverageWarnGlyph() {
  return (
    <svg className={styles.coverageWarnSvg} viewBox="0 0 16 16" width="11" height="11" aria-hidden>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.2v5M8 11.3v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

type BookCardProps = {
  book: Book;
  seriesBookCount: number;
  bookHasRag: boolean;
  currentEmbeddingModel: string | null;
  currentEmbeddingPassagePrefix: string;
  deleting: boolean;
  erroredJobType?: JobType;
  onDelete: () => void;
  onViewAbstracts: () => void;
  onRetryAbstracts: () => void;
  onRetryEmbedding: () => void;
  onResumeJob: (type: JobType) => void;
  onInspectEmbeddings: () => void;
  onExport: () => void;
  onSetEmbeddingOverride: (override: boolean) => void;
  onUpdate: (patch: {
    title?: string;
    author?: string | null;
    year?: number | null;
    genre?: string | null;
    language?: string | null;
  }) => Promise<void>;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
};

function BookCard({
  book, seriesBookCount, bookHasRag, currentEmbeddingModel, currentEmbeddingPassagePrefix, deleting,
  erroredJobType, onDelete, onViewAbstracts,
  onRetryAbstracts, onRetryEmbedding, onResumeJob, onInspectEmbeddings, onExport, onSetEmbeddingOverride,
  onUpdate,
  dragHandleProps,
}: BookCardProps) {
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editLanguage, setEditLanguage] = useState('');

  function openEdit() {
    setEditTitle(book.title);
    setEditAuthor(book.author ?? '');
    setEditYear(book.year ? String(book.year) : '');
    setEditGenre(book.genre ?? '');
    setEditLanguage(book.language ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    const title = editTitle.trim();
    if (!title) return;
    setSaving(true);
    try {
      await onUpdate({
        title,
        author: editAuthor.trim() || null,
        year: editYear.trim() ? parseInt(editYear.trim(), 10) || null : null,
        genre: editGenre.trim() || null,
        language: editLanguage.trim() || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    setEditing(false);
  }
  const hasAbstracts = !!book.abstractedAt;
  const hasEmbeddings = !!book.embeddedAt;
  const showRagStrike = book.chunkCount === 0 || !bookHasRag;

  const overrideActive = embeddingOverrideActive(
    book,
    currentEmbeddingModel,
    currentEmbeddingPassagePrefix,
  );
  const profileMismatch =
    hasEmbeddings &&
    bookEmbeddingProfileMismatch(book, currentEmbeddingModel, currentEmbeddingPassagePrefix);

  return (
    <div
      className={`${styles.bookCard} ${
        dragHandleProps && !editing ? styles.bookCardWithDragHandle : ''
      }`}
    >
      {!editing && dragHandleProps && (
        <button
          type="button"
          className={styles.dragHandle}
          title="Drag to reorder in series"
          {...dragHandleProps}
        >
          ⋮⋮
        </button>
      )}
      {editing ? (
        <form
          className={styles.bookEditForm}
          onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}
        >
          <input
            className={styles.bookEditInput}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
          />
          <input
            className={styles.bookEditInput}
            value={editAuthor}
            onChange={(e) => setEditAuthor(e.target.value)}
            placeholder="Author"
            onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
          />
          <div className={styles.bookEditRow}>
            <input
              className={styles.bookEditInput}
              value={editYear}
              onChange={(e) => setEditYear(e.target.value)}
              placeholder="Year"
              type="number"
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
            />
            <input
              className={styles.bookEditInput}
              value={editLanguage}
              onChange={(e) => setEditLanguage(e.target.value)}
              placeholder="Language"
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
            />
          </div>
          <input
            className={styles.bookEditInput}
            value={editGenre}
            onChange={(e) => setEditGenre(e.target.value)}
            placeholder="Genre"
            onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
          />
          <div className={styles.bookEditActions}>
            <button type="submit" className={styles.bookEditSave} disabled={saving || !editTitle.trim()}>
              {saving ? '…' : 'Save'}
            </button>
            <button type="button" className={styles.bookEditCancel} onClick={cancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.bookTitle}>
            {seriesBookCount > 1 && book.seriesOrder != null && (
              <span className={styles.orderBadge}>{book.seriesOrder}</span>
            )}
            {book.title}
          </div>
          <div className={styles.bookMeta}>
            {[book.author, book.year, book.language, book.genre].filter(Boolean).join(' · ')}
          </div>
        </>
      )}
      <div className={styles.bookStats}>
        <span>{book.chunkCount.toLocaleString()} chunks</span>
        <span>{(book.wordCount / 1000).toFixed(1)}k words</span>
        {book.ingestedAt && (
          <span>{new Date(book.ingestedAt).toLocaleDateString()}</span>
        )}
        {hasEmbeddings && (
          <span title={book.embeddingModel ? `Model: ${book.embeddingModel}` : 'Embedded'}>
            ⬡ {book.embeddingModel ?? 'embedded'}
          </span>
        )}
      </div>

      <div className={styles.bookFeatureRow} title="Book-level abstract and retrieval vectors for this volume">
        <span className={hasAbstracts ? '' : styles.featureStruck}>Abstracts</span>
        <span className={styles.featureSep} aria-hidden>
          ·
        </span>
        <span className={showRagStrike ? styles.featureStruck : ''}>RAG</span>
      </div>

      {profileMismatch && !overrideActive && !confirmingOverride && (
        <div className={styles.modelMismatch}>
          <span
            title={`Stored: model "${book.embeddingModel ?? ''}", passage "${normalizeEmbeddingPrefix(book.embeddingPassagePrefixSnapshot)}". Current: model "${currentEmbeddingModel ?? ''}", passage "${normalizeEmbeddingPrefix(currentEmbeddingPassagePrefix)}". Re-embed or allow override.`}
          >
            ⚠ embedding profile mismatch — RAG disabled
          </span>
          <button className={styles.overrideBtn} onClick={() => setConfirmingOverride(true)}>
            Allow RAG
          </button>
        </div>
      )}
      {profileMismatch && !overrideActive && confirmingOverride && (
        <div className={styles.modelMismatchConfirm}>
          <span className={styles.modelMismatchConfirmText}>
            Retrieval scores may be unreliable (model and/or query/passage instruct prefixes). Continue?
          </span>
          <div className={styles.modelMismatchConfirmBtns}>
            <button
              className={styles.overrideBtn}
              onClick={() => { onSetEmbeddingOverride(true); setConfirmingOverride(false); }}
            >
              Yes, allow
            </button>
            <button className={styles.overrideBtnRevoke} onClick={() => setConfirmingOverride(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {overrideActive && (
        <div className={styles.modelOverrideActive}>
          <span
            title={`Override matches current settings: model "${(currentEmbeddingModel ?? '').trim()}", passage "${normalizeEmbeddingPrefix(currentEmbeddingPassagePrefix)}". Stored vectors: model "${(book.embeddingModel ?? '').trim()}", passage "${normalizeEmbeddingPrefix(book.embeddingPassagePrefixSnapshot)}".`}
          >
            ⚓ RAG override active
          </span>
          <button
            className={styles.overrideBtnRevoke}
            onClick={() => onSetEmbeddingOverride(false)}
            title="Revoke override — re-enable embedding profile check (model and passage prefix)"
          >
            Revoke
          </button>
        </div>
      )}

      {book.ingestedAt && (
        <div className={styles.cardActions}>
          <button
            className={styles.actionBtn}
            onClick={hasAbstracts ? onViewAbstracts : undefined}
            disabled={!hasAbstracts}
            title={hasAbstracts ? 'View abstracts' : 'Abstracts not generated yet'}
          >
            Abstracts
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => {
              if (hasAbstracts && !window.confirm('Regenerate abstracts? The existing abstracts will be replaced.')) return;
              onRetryAbstracts();
            }}
            title={hasAbstracts ? 'Re-generate abstracts' : 'Generate abstracts'}
          >
            {hasAbstracts ? '↺ abstracts' : '⊕ abstracts'}
          </button>
          {erroredJobType === 'abstract_generation' && (
            <button
              className={styles.actionBtnResume}
              onClick={() => onResumeJob('abstract_generation')}
              title="Continue abstract generation — skip already-processed sections"
            >
              ↻ continue abstracts
            </button>
          )}
          <button
            className={styles.actionBtn}
            onClick={() => {
              if (hasEmbeddings && !window.confirm('Regenerate embeddings? The existing embeddings will be replaced.')) return;
              onRetryEmbedding();
            }}
            title={hasEmbeddings ? 'Re-generate embeddings' : 'Generate embeddings'}
          >
            {hasEmbeddings ? '↺ embed' : '⊕ embed'}
          </button>
          {erroredJobType === 'embedding_generation' && (
            <button
              className={styles.actionBtnResume}
              onClick={() => onResumeJob('embedding_generation')}
              title="Continue embedding — skip already-embedded chunks (blocked if embedding model changed)"
            >
              ↻ continue embed
            </button>
          )}
          {hasEmbeddings && (
            <button
              className={styles.actionBtn}
              onClick={onInspectEmbeddings}
              title="Inspect embeddings — search chunks by semantic similarity"
            >
              ⊕ inspect
            </button>
          )}
          <button
            className={styles.actionBtn}
            onClick={onExport}
            title="Export book as .zip"
          >
            ⬇ export
          </button>
        </div>
      )}

      <button
        className={styles.editBtn}
        onClick={openEdit}
        title="Edit book details"
        disabled={editing}
      >
        ✎
      </button>
      <button
        className={styles.deleteBtn}
        onClick={onDelete}
        disabled={deleting}
        title="Remove book"
      >
        {deleting ? '…' : '✕'}
      </button>
    </div>
  );
}

type BookCardExtras = Omit<BookCardProps, 'book' | 'seriesBookCount' | 'dragHandleProps'>;

function SortableBookCard(props: BookCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.book.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
    zIndex: isDragging ? 2 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={styles.sortableBookSlot}>
      <BookCard
        {...props}
        dragHandleProps={{ ...attributes, ...listeners } as HTMLAttributes<HTMLButtonElement>}
      />
    </div>
  );
}

function SeriesBookGrid({
  seriesId,
  books,
  volCount,
  onReorder,
  getBookCardExtras,
}: {
  seriesId: string;
  books: Book[];
  volCount: number;
  onReorder: (seriesId: string, bookIds: string[]) => void | Promise<void>;
  getBookCardExtras: (book: Book) => BookCardExtras;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = books.map((b) => b.id);
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const order = books.map((b) => b.id);
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    void onReorder(seriesId, arrayMove(order, oldIndex, newIndex));
  }
  if (volCount <= 1) {
    return (
      <div className={styles.bookGrid}>
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            seriesBookCount={volCount}
            {...getBookCardExtras(book)}
          />
        ))}
      </div>
    );
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={styles.bookGrid}>
          {books.map((book) => (
            <SortableBookCard
              key={book.id}
              book={book}
              seriesBookCount={volCount}
              {...getBookCardExtras(book)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
