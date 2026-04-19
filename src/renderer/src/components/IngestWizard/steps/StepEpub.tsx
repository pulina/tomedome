import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { TagListEditor } from '../TagListEditor';
import styles from '../IngestWizard.module.css';

interface Props {
  boilerplateSelectors: string[];
  setBoilerplateSelectors: Dispatch<SetStateAction<string[]>>;
  skipLabelPatterns: string[];
  setSkipLabelPatterns: Dispatch<SetStateAction<string[]>>;
  includeLabelPatterns: string[];
  setIncludeLabelPatterns: Dispatch<SetStateAction<string[]>>;
}

export function StepEpub({
  boilerplateSelectors,
  setBoilerplateSelectors,
  skipLabelPatterns,
  setSkipLabelPatterns,
  includeLabelPatterns,
  setIncludeLabelPatterns,
}: Props) {
  const [showOptions, setShowOptions] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.advancedToggle}
        onClick={() => setShowOptions((v) => !v)}
      >
        <span>⚙ Advanced EPUB options</span>
        <span className={styles.advancedToggleHint}>something doesn&apos;t look right in preview? adjust extraction here</span>
        <span className={styles.advancedToggleArrow}>{showOptions ? '▲' : '▼'}</span>
      </button>
      {showOptions && (
        <div className={styles.advancedPanel}>
          <TagListEditor
            label="Boilerplate selectors"
            hint="CSS selectors — matching elements are stripped before text extraction"
            items={boilerplateSelectors}
            onAdd={(v) => setBoilerplateSelectors((prev) => [...prev, v])}
            onRemove={(v) => setBoilerplateSelectors((prev) => prev.filter((x) => x !== v))}
          />
          <TagListEditor
            label="Skip label patterns"
            hint="Case-insensitive regexes — TOC entries matching any are excluded entirely"
            items={skipLabelPatterns}
            onAdd={(v) => setSkipLabelPatterns((prev) => [...prev, v])}
            onRemove={(v) => setSkipLabelPatterns((prev) => prev.filter((x) => x !== v))}
          />
          <TagListEditor
            label="Include label patterns"
            hint="Case-insensitive regexes — TOC entries must match at least one to be included as a chapter"
            items={includeLabelPatterns}
            onAdd={(v) => setIncludeLabelPatterns((prev) => [...prev, v])}
            onRemove={(v) => setIncludeLabelPatterns((prev) => prev.filter((x) => x !== v))}
          />
        </div>
      )}
    </>
  );
}
