import { useState } from 'react';
import styles from './IngestWizard.module.css';

interface Props {
  label: string;
  hint: string;
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}

export function TagListEditor({ label, hint, items, onAdd, onRemove }: Props) {
  const [input, setInput] = useState('');

  function commit() {
    const v = input.trim();
    if (v && !items.includes(v)) {
      onAdd(v);
      setInput('');
    }
  }

  return (
    <div className={styles.advancedSection}>
      <div className={styles.advancedSectionLabel}>{label}</div>
      <div className={styles.fieldHint}>{hint}</div>
      <div className={styles.tagList}>
        {items.map((item) => (
          <span key={item} className={styles.tagPill}>
            <span className={styles.tagPillText}>{item}</span>
            <button
              type="button"
              className={styles.tagPillRemove}
              onClick={() => onRemove(item)}
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span className={styles.tagPillEmpty}>none</span>
        )}
      </div>
      <div className={styles.customRow}>
        <input
          className={styles.customInput}
          placeholder="Add… (press Enter)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          spellCheck={false}
        />
        <button className={styles.applyBtn} onClick={commit} disabled={!input.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
