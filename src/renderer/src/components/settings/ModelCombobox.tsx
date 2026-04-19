import { useEffect, useRef, useState } from 'react';
import styles from './ModelCombobox.module.css';

interface Props {
  id?: string;
  models: string[];
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onOther: () => void;
}

export function ModelCombobox({ id, models, value, placeholder, onChange, onOther }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = query
    ? models.filter((m) => m.toLowerCase().includes(query.toLowerCase()))
    : models;

  function openDropdown() {
    setQuery('');
    setHighlighted(0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery('');
  }

  function select(item: string | '__other__') {
    if (item === '__other__') {
      onOther();
    } else {
      onChange(item);
    }
    close();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const total = filtered.length + 1; // +1 for Other
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = highlighted < filtered.length ? filtered[highlighted] : '__other__';
      select(item);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlighted] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {open ? (
        <input
          ref={inputRef}
          id={id}
          className={styles.search}
          type="text"
          placeholder="Search models…"
          value={query}
          autoFocus
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <button type="button" id={id} className={styles.trigger} onClick={openDropdown}>
          <span className={value ? styles.triggerValue : styles.triggerPlaceholder}>
            {value || placeholder || 'Select a model'}
          </span>
          <span className={styles.arrow}>▾</span>
        </button>
      )}

      {open && (
        <ul ref={listRef} className={styles.dropdown}>
          {filtered.length === 0 && <li className={styles.empty}>No matches</li>}
          {filtered.map((m, i) => (
            <li
              key={m}
              className={`${styles.option} ${i === highlighted ? styles.optionHighlighted : ''}`}
              onMouseDown={() => select(m)}
              onMouseEnter={() => setHighlighted(i)}
            >
              {m}
            </li>
          ))}
          <li
            className={`${styles.option} ${styles.optionOther} ${
              highlighted === filtered.length ? styles.optionHighlighted : ''
            }`}
            onMouseDown={() => select('__other__')}
            onMouseEnter={() => setHighlighted(filtered.length)}
          >
            Other…
          </li>
        </ul>
      )}
    </div>
  );
}
