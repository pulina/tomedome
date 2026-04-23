import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Book, ImportResult, Series } from '../../../shared/types';
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
  const sseCloseRef = useRef<(() => void) | null>(null);
  const location = useLocation();

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
                <div className={styles.bookGrid}>
                  {group.books.map((book) => (
                    <BookCard
                      key={book.id}
                      book={book}
                      bookHasRag={bookHasRag(book, currentEmbeddingModel, currentEmbeddingPassagePrefix)}
                      currentEmbeddingModel={currentEmbeddingModel}
                      currentEmbeddingPassagePrefix={currentEmbeddingPassagePrefix}
                      deleting={deleting === book.id}
                      onDelete={() => handleDelete(book.id)}
                      onViewAbstracts={() => setAbstractsBookId(book.id)}
                      onRetryAbstracts={() => handleEnqueueJob(book.id, 'abstract_generation')}
                      onRetryEmbedding={() => handleEnqueueJob(book.id, 'embedding_generation')}
                      onInspectEmbeddings={() => setInspectorBookId(book.id)}
                      onExport={() => setExportTarget({ kind: 'book', id: book.id, title: book.title })}
                      onSetEmbeddingOverride={(v) => void handleSetEmbeddingOverride(book.id, v)}
                    />
                  ))}
                </div>
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

function BookCard({
  book, bookHasRag, currentEmbeddingModel, currentEmbeddingPassagePrefix, deleting, onDelete, onViewAbstracts,
  onRetryAbstracts, onRetryEmbedding, onInspectEmbeddings, onExport, onSetEmbeddingOverride,
}: {
  book: Book;
  bookHasRag: boolean;
  currentEmbeddingModel: string | null;
  currentEmbeddingPassagePrefix: string;
  deleting: boolean;
  onDelete: () => void;
  onViewAbstracts: () => void;
  onRetryAbstracts: () => void;
  onRetryEmbedding: () => void;
  onInspectEmbeddings: () => void;
  onExport: () => void;
  onSetEmbeddingOverride: (override: boolean) => void;
}) {
  const [confirmingOverride, setConfirmingOverride] = useState(false);
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
    <div className={styles.bookCard}>
      <div className={styles.bookTitle}>{book.title}</div>
      <div className={styles.bookMeta}>
        {[book.author, book.year, book.genre].filter(Boolean).join(' · ')}
      </div>
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
