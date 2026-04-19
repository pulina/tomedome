import { useState } from 'react';
import { bookApi } from '../../api/book-api';
import type { EmbeddingSearchResult } from '../../../../shared/types';
import styles from './EmbeddingsInspector.module.css';

interface Props {
  bookId: string;
  bookTitle: string;
  bookEmbeddingModel?: string;
  currentEmbeddingModel: string | null;
  embeddingModelOverride?: boolean;
  onClose: () => void;
  onSetEmbeddingOverride: (override: boolean) => void;
}

export function EmbeddingsInspector({ bookId, bookTitle, bookEmbeddingModel, currentEmbeddingModel, embeddingModelOverride, onClose, onSetEmbeddingOverride }: Props) {
  const [query, setQuery] = useState('');
  const [n, setN] = useState(10);
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const [results, setResults] = useState<EmbeddingSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await bookApi.searchEmbeddings(bookId, query.trim(), n);
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleSearch();
    }
  }

  const modelMismatch =
    !!bookEmbeddingModel && !!currentEmbeddingModel && bookEmbeddingModel !== currentEmbeddingModel;

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{bookTitle} — Embeddings Inspector</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modelInfo}>
          <span className={styles.modelRow}>
            <span className={styles.modelLabel}>stored</span>
            <span className={modelMismatch ? styles.modelValueWarn : styles.modelValue}>
              {bookEmbeddingModel ?? 'unknown'}
            </span>
          </span>
          <span className={styles.modelSep}>·</span>
          <span className={styles.modelRow}>
            <span className={styles.modelLabel}>query</span>
            <span className={styles.modelValue}>{currentEmbeddingModel ?? 'none'}</span>
          </span>
          {modelMismatch && !embeddingModelOverride && !confirmingOverride && (
            <>
              <span className={styles.modelMismatch}>⚠ model mismatch — scores unreliable</span>
              <button className={styles.overrideBtn} onClick={() => setConfirmingOverride(true)}>
                Allow RAG
              </button>
            </>
          )}
          {modelMismatch && !embeddingModelOverride && confirmingOverride && (
            <>
              <span className={styles.modelMismatchConfirm}>
                Scores unreliable unless models share the same vector space. Continue?
              </span>
              <button
                className={styles.overrideBtn}
                onClick={() => { onSetEmbeddingOverride(true); setConfirmingOverride(false); }}
              >
                Yes, allow
              </button>
              <button className={styles.overrideBtnRevoke} onClick={() => setConfirmingOverride(false)}>
                Cancel
              </button>
            </>
          )}
          {modelMismatch && embeddingModelOverride && (
            <>
              <span className={styles.modelOverrideActive}>⚓ RAG override active</span>
              <button
                className={styles.overrideBtnRevoke}
                onClick={() => onSetEmbeddingOverride(false)}
              >
                Revoke
              </button>
            </>
          )}
        </div>

        <div className={styles.querySection}>
          <textarea
            className={styles.queryInput}
            placeholder="Enter a query to find similar chunks… (Cmd/Ctrl+Enter to search)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.queryControls}>
            <label className={styles.nLabel}>
              Top
              <input
                type="number"
                className={styles.nInput}
                min={1}
                max={50}
                value={n}
                onChange={(e) => setN(Math.max(1, Math.min(50, Number(e.target.value))))}
              />
              results
            </label>
            <button
              className={styles.searchBtn}
              onClick={() => void handleSearch()}
              disabled={loading || !query.trim()}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>

        <div className={styles.body}>
          {!loading && !error && results === null && (
            <div className={styles.status}>
              Enter a query above to retrieve semantically similar chunks from this book.
            </div>
          )}
          {loading && (
            <div className={styles.status}>Embedding query and searching…</div>
          )}
          {error && <div className={styles.statusError}>{error}</div>}
          {results !== null && results.length === 0 && (
            <div className={styles.status}>No results found.</div>
          )}
          {results !== null && results.map((r, i) => (
            <ResultCard key={r.chunkId} rank={i + 1} result={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

const ABSTRACT_LEVEL_LABEL: Record<string, string> = {
  chapter_detailed: 'chapter summary',
  chapter_short: 'chapter abstract',
  book: 'book summary',
};

function ResultCard({ rank, result }: { rank: number; result: EmbeddingSearchResult }) {
  const scoreClass =
    result.score >= 0.75 ? styles.scoreHigh : result.score >= 0.5 ? styles.scoreMid : styles.scoreLow;

  const chapterLabel =
    result.chapterTitle ?? (result.chapterNumber !== null ? `Ch. ${result.chapterNumber}` : 'Unchaptered');

  const sourceLabel =
    result.source === 'abstract'
      ? (ABSTRACT_LEVEL_LABEL[result.abstractLevel ?? ''] ?? 'summary')
      : null;

  return (
    <div className={styles.resultCard}>
      <div className={styles.resultMeta}>
        <span className={styles.resultRank}>#{rank}</span>
        <span className={`${styles.resultScore} ${scoreClass}`}>
          {result.score.toFixed(4)}
        </span>
        <span className={styles.resultChapter}>{chapterLabel}</span>
        {sourceLabel && (
          <span className={styles.sourceBadge}>{sourceLabel}</span>
        )}
      </div>
      <div className={styles.resultText}>{result.text}</div>
    </div>
  );
}
