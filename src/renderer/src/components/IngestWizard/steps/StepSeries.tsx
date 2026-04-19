import type { Series } from '@shared/types';
import styles from '../IngestWizard.module.css';

interface Props {
  seriesList: Series[];
  loading: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  creatingNew: boolean;
  newTitle: string;
  onNewTitle: (v: string) => void;
  onToggleNew: () => void;
  onCreateNew: () => void;
}

export function StepSeries({
  seriesList,
  loading,
  selected,
  onSelect,
  creatingNew,
  newTitle,
  onNewTitle,
  onToggleNew,
  onCreateNew,
}: Props) {
  if (loading) return <div className={styles.loadingText}>Loading series…</div>;

  return (
    <>
      {seriesList.length > 0 && (
        <div className={styles.seriesList}>
          {seriesList.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.seriesItem} ${selected === s.id ? styles.seriesItemSelected : ''}`}
              onClick={() => onSelect(s.id)}
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
            value={newTitle}
            onChange={(e) => onNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreateNew()}
            autoFocus
          />
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onCreateNew} disabled={!newTitle.trim()}>
            Create
          </button>
          <button className={styles.btn} onClick={onToggleNew}>Cancel</button>
        </div>
      ) : (
        <button className={styles.newSeriesBtn} onClick={onToggleNew}>
          ⊕ New series
        </button>
      )}
      {seriesList.length === 0 && !creatingNew && (
        <div className={styles.loadingText}>No series yet — create one above.</div>
      )}
    </>
  );
}
