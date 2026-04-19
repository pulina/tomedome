import { useEffect, useRef, useState } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { bookApi } from '../../api/book-api';
import type { Abstract } from '../../../../shared/types';
import styles from './AbstractsModal.module.css';

type Tab = 'book' | 'chapters' | 'detailed';

interface Props {
  bookId: string;
  bookTitle: string;
  onClose: () => void;
}

export function AbstractsModal({ bookId, bookTitle, onClose }: Props) {
  const [abstracts, setAbstracts] = useState<Abstract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('book');

  // Detailed tab: how many chapters are currently revealed
  const [detailedVisible, setDetailedVisible] = useState(3);
  const bodyRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(modalRef);

  useEffect(() => {
    bookApi
      .getAbstracts(bookId)
      .then(setAbstracts)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookId]);

  // Reset detailed pager when switching to detailed tab
  useEffect(() => {
    if (tab === 'detailed') setDetailedVisible(3);
  }, [tab]);

  const bookAbstract = abstracts.find((a) => a.level === 'book');
  const chapterShorts = abstracts
    .filter((a) => a.level === 'chapter_short')
    .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  const chapterDetaileds = abstracts
    .filter((a) => a.level === 'chapter_detailed')
    .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));

  const visibleDetaileds = chapterDetaileds.slice(0, detailedVisible);
  const hasMore = detailedVisible < chapterDetaileds.length;

  // Auto-load when scrolled near the bottom of the body container.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    function onScroll() {
      if (!body) return;
      if (body.scrollHeight - body.scrollTop - body.clientHeight < 120) {
        setDetailedVisible((v) => v + 3);
      }
    }
    body.addEventListener('scroll', onScroll);
    return () => body.removeEventListener('scroll', onScroll);
  }, [tab]);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.title}>{bookTitle}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'book' ? styles.tabActive : ''}`}
            onClick={() => setTab('book')}
          >
            Book Abstract
          </button>
          <button
            className={`${styles.tab} ${tab === 'chapters' ? styles.tabActive : ''}`}
            onClick={() => setTab('chapters')}
          >
            Chapters
            {chapterShorts.length > 0 && (
              <span className={styles.tabCount}>{chapterShorts.length}</span>
            )}
          </button>
          <button
            className={`${styles.tab} ${tab === 'detailed' ? styles.tabActive : ''}`}
            onClick={() => setTab('detailed')}
          >
            Detailed
            {chapterDetaileds.length > 0 && (
              <span className={styles.tabCount}>{chapterDetaileds.length}</span>
            )}
          </button>
        </div>

        <div className={styles.body} ref={bodyRef}>
          {loading && <div className={styles.status}>Loading abstracts…</div>}
          {error && <div className={styles.statusError}>{error}</div>}

          {!loading && !error && abstracts.length === 0 && (
            <div className={styles.status}>
              No abstracts yet. Use the ⊕ abstracts button on the book card to generate them.
            </div>
          )}

          {/* ── Book Abstract tab ── */}
          {!loading && !error && tab === 'book' && (
            bookAbstract ? (
              <div className={styles.detailedWall}>
                <div className={styles.detailedChunk}>
                  <div className={styles.detailedChunkLabel}>Book Abstract</div>
                  <div className={styles.detailedChunkText}>{bookAbstract.content}</div>
                </div>
              </div>
            ) : abstracts.length > 0 ? (
              <div className={styles.status}>Book abstract not available.</div>
            ) : null
          )}

          {/* ── Chapters tab ── */}
          {!loading && !error && tab === 'chapters' && (
            chapterShorts.length > 0 ? (
              <div className={styles.detailedWall}>
                {chapterShorts.map((cs) => (
                  <div key={cs.id} className={styles.detailedChunk}>
                    {(cs.chapterTitle || cs.chapterNumber !== null) && (
                      <div className={styles.detailedChunkLabel}>
                        {cs.chapterTitle ?? `Chapter ${cs.chapterNumber}`}
                      </div>
                    )}
                    <div className={styles.detailedChunkText}>{cs.content}</div>
                  </div>
                ))}
              </div>
            ) : abstracts.length > 0 ? (
              <div className={styles.status}>Chapter abstracts not available.</div>
            ) : null
          )}

          {/* ── Detailed tab ── */}
          {!loading && !error && tab === 'detailed' && (
            chapterDetaileds.length > 0 ? (
              <div className={styles.detailedWall}>
                {visibleDetaileds.map((d) => (
                  <div key={d.id} className={styles.detailedChunk}>
                    {(d.chapterTitle || d.chapterNumber !== null) && (
                      <div className={styles.detailedChunkLabel}>
                        {d.chapterTitle ?? `Chapter ${d.chapterNumber}`}
                      </div>
                    )}
                    <div className={styles.detailedChunkText}>{d.content}</div>
                  </div>
                ))}
                {!hasMore && chapterDetaileds.length > 3 && (
                  <div className={styles.allLoaded}>
                    All {chapterDetaileds.length} chapters loaded
                  </div>
                )}
              </div>
            ) : abstracts.length > 0 ? (
              <div className={styles.status}>Detailed abstracts not available.</div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
