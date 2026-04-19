import { useState } from 'react';
import type { Series } from '../../../../shared/types';
import styles from './ImportBookModal.module.css';

interface Props {
  bookTitle: string;
  defaultSeriesTitle: string;
  seriesList: Series[];
  onConfirm: (seriesId: string) => void;
  onClose: () => void;
}

export function ImportBookModal({ bookTitle, defaultSeriesTitle, seriesList, onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<string>(seriesList[0]?.id ?? '__new__');
  const [newTitle, setNewTitle] = useState(defaultSeriesTitle);

  const isNew = selected === '__new__';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Import book</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.body}>
          <p className={styles.bookName}>{bookTitle}</p>
          <p className={styles.label}>Import into series</p>
          <div className={styles.list}>
            {seriesList.map((s) => (
              <label key={s.id} className={`${styles.item} ${selected === s.id ? styles.itemSelected : ''}`}>
                <input
                  type="radio"
                  name="series"
                  value={s.id}
                  checked={selected === s.id}
                  onChange={() => setSelected(s.id)}
                />
                {s.title}
              </label>
            ))}
            <label className={`${styles.item} ${isNew ? styles.itemSelected : ''}`}>
              <input
                type="radio"
                name="series"
                value="__new__"
                checked={isNew}
                onChange={() => setSelected('__new__')}
              />
              Create new series…
            </label>
          </div>
          {isNew && (
            <input
              className={styles.newInput}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Series name"
              autoFocus
            />
          )}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.importBtn}
            disabled={isNew && !newTitle.trim()}
            onClick={() => onConfirm(isNew ? `__new__:${newTitle.trim()}` : selected)}
          >
            ↑ Import
          </button>
        </div>
      </div>
    </div>
  );
}
