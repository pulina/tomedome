import { useRef, useState } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import styles from './ExportModal.module.css';

interface Props {
  title: string;
  onConfirm: (includeEmbeddings: boolean) => void;
  onClose: () => void;
}

export function ExportModal({ title, onConfirm, onClose }: Props) {
  const [includeEmbeddings, setIncludeEmbeddings] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(modalRef);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>Export</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.body}>
          <p className={styles.target}>{title}</p>
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={includeEmbeddings}
              onChange={(e) => setIncludeEmbeddings(e.target.checked)}
            />
            <span>Include RAG embeddings</span>
            <span className={styles.hint}>(larger file, skip re-embedding on import)</span>
          </label>
          <div className={styles.disclaimerBox} role="note">
            <span className={styles.disclaimerIcon} aria-hidden>
              ⚠
            </span>
            <p className={styles.disclaimerText}>
              This bundle includes book content. Sharing it publicly may violate the licence or other rights
              that apply to that material.
            </p>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.exportBtn} onClick={() => onConfirm(includeEmbeddings)}>
            ⬇ Export
          </button>
        </div>
      </div>
    </div>
  );
}
