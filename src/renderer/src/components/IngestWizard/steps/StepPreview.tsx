import { ReactNode, useEffect, useRef, useState } from 'react';
import type { BookStats } from '@shared/types';
import { CHAPTER_PRESETS, PREVIEW_PAGE, SECTION_PRESETS } from '../constants';
import type { ChunkingUIState } from '../chunking-types';
import styles from '../IngestWizard.module.css';

interface Props {
  stats: BookStats | null;
  loading: boolean;
  error: string | null;
  chunkingState: ChunkingUIState;
  excludedChunkIndices: Set<number>;
  onToggleExclude: (index: number) => void;
  showControls?: boolean;
}

export function StepPreview({
  stats,
  loading,
  error,
  chunkingState,
  excludedChunkIndices,
  onToggleExclude,
  showControls = true,
}: Props) {
  const [visible, setVisible] = useState(PREVIEW_PAGE);
  const [showOptions, setShowOptions] = useState(false);
  const [pendingScrollToBottom, setPendingScrollToBottom] = useState(false);
  const spineRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setVisible(PREVIEW_PAGE); }, [stats]);

  useEffect(() => {
    if (pendingScrollToBottom && spineRef.current) {
      spineRef.current.scrollTop = spineRef.current.scrollHeight;
      setPendingScrollToBottom(false);
    }
  }, [visible, pendingScrollToBottom]);

  const cs = chunkingState;

  const optionsPanel = (
    <div className={styles.advancedPanel}>
      <div className={styles.advancedSection}>
        <div className={styles.advancedSectionLabel}>Chapter / section detection</div>
        {CHAPTER_PRESETS.map((preset) => (
          <label key={preset.id} className={styles.presetRow}>
            <input
              type="checkbox"
              className={styles.presetCheck}
              checked={cs.chapterPresets.has(preset.id)}
              onChange={() => cs.onToggleChapterPreset(preset.id)}
            />
            <span className={styles.presetLabel}>{preset.label}</span>
            <span className={styles.presetHint}>{preset.hint}</span>
          </label>
        ))}
        <div className={styles.customRow}>
          <input
            className={styles.customInput}
            placeholder="Custom regex… e.g. ^letter\s+\d+"
            value={cs.chapterCustomInput}
            onChange={(e) => cs.onChapterCustomInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && cs.onChapterCustomCommit()}
            onBlur={cs.onChapterCustomCommit}
            spellCheck={false}
            title="Matched against each line (trimmed, case-insensitive). Use ^ to anchor to line start. No capture groups needed — the whole line becomes the chapter title. Example: ^chapter\s+\d+ matches 'Chapter 4'; ^letter\s+\d+ matches 'Letter 2'."
          />
          <button className={styles.applyBtn} onClick={cs.onChapterCustomCommit}>Apply</button>
        </div>
        <span className={styles.presetHint}>matched per line (trimmed, case-insensitive) — the matched line becomes the chapter title</span>
      </div>

      <div className={styles.advancedSection}>
        <div className={styles.advancedSectionLabel}>Paragraph separators</div>
        <div className={styles.presetRow}>
          <input type="checkbox" className={styles.presetCheck} checked disabled readOnly />
          <span className={styles.presetLabel}>Blank line</span>
          <span className={styles.presetHint}>always on</span>
        </div>
        {SECTION_PRESETS.map((preset) => (
          <label key={preset.id} className={styles.presetRow}>
            <input
              type="checkbox"
              className={styles.presetCheck}
              checked={cs.sectionPresets.has(preset.id)}
              onChange={() => cs.onToggleSectionPreset(preset.id)}
            />
            <span className={styles.presetLabel}>{preset.label}</span>
            <span className={styles.presetHint}>{preset.hint}</span>
          </label>
        ))}
        <div className={styles.customRow}>
          <input
            className={styles.customInput}
            placeholder="Custom regex… (press Enter or Apply)"
            value={cs.sectionCustomInput}
            onChange={(e) => cs.onSectionCustomInputChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && cs.onSectionCustomCommit()}
            onBlur={cs.onSectionCustomCommit}
            spellCheck={false}
          />
          <button className={styles.applyBtn} onClick={cs.onSectionCustomCommit}>Apply</button>
        </div>
      </div>

      <div className={styles.advancedSection}>
        <div className={styles.advancedSectionLabel}>Chunk token limits</div>
        <div className={styles.tokenRow}>
          <label className={styles.tokenLabel}>
            Min
            <input
              type="number"
              className={styles.tokenInput}
              value={cs.minTokens}
              min={1}
              max={cs.maxTokens - 1}
              onChange={(e) => cs.onMinTokensChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
            <span className={styles.presetHint}>tokens — paragraphs shorter than this are dropped</span>
          </label>
          <label className={styles.tokenLabel}>
            Max
            <input
              type="number"
              className={styles.tokenInput}
              value={cs.maxTokens}
              min={cs.minTokens + 1}
              max={4000}
              onChange={(e) => cs.onMaxTokensChange(Math.min(4000, parseInt(e.target.value, 10) || 600))}
            />
            <span className={styles.presetHint}>tokens — longer paragraphs are split at sentence boundaries</span>
          </label>
          <label className={styles.tokenLabel}>
            Merge below
            <input
              type="number"
              className={styles.tokenInput}
              value={cs.mergeThreshold}
              min={0}
              max={cs.maxTokens}
              onChange={(e) => cs.onMergeThresholdChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
              onBlur={() => cs.onMergeThresholdBlur()}
            />
            <span className={styles.presetHint}>tokens — merge into adjacent chunk (0 = off)</span>
          </label>
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <>
      {showControls && (
        <>
          <button
            type="button"
            className={styles.advancedToggle}
            onClick={() => setShowOptions((v) => !v)}
          >
            <span>⚙ Chunking options</span>
            <span className={styles.advancedToggleHint}>adjust if preview looks incorrect</span>
            <span className={styles.advancedToggleArrow}>{showOptions ? '▲' : '▼'}</span>
          </button>
          {showOptions && optionsPanel}
        </>
      )}
      <div className={styles.loadingText}>Parsing file…</div>
    </>
  );
  if (error) return <div className={styles.errorText}>{error}</div>;
  if (!stats) return null;

  const visibleChunks = stats.chunks.slice(0, visible);
  const hasMore = visible < stats.chunks.length;

  const rows: ReactNode[] = [];
  let lastChapterNumber: number | null | undefined = undefined;

  for (const chunk of visibleChunks) {
    if (chunk.chapterNumber !== lastChapterNumber) {
      const label =
        chunk.chapterTitle ??
        (chunk.chapterNumber !== null ? `Section ${chunk.chapterNumber}` : 'Preamble');
      rows.push(
        <div key={`ch-${chunk.index}`} className={styles.chapterDivider}>
          <span className={styles.chapterDividerLabel}>{label}</span>
        </div>,
      );
      lastChapterNumber = chunk.chapterNumber;
    }
    const isExcluded = excludedChunkIndices.has(chunk.index);
    rows.push(
      <div
        key={chunk.index}
        className={`${styles.chunkRow} ${isExcluded ? styles.chunkRowExcluded : ''}`}
      >
        <div className={styles.chunkRowMeta}>
          <span className={styles.chunkIdx}>#{chunk.index + 1}</span>
          <span className={styles.chunkTokens}>{chunk.tokenCount}t</span>
        </div>
        <div className={styles.chunkRowText}>{chunk.rawText}</div>
        <button
          type="button"
          className={`${styles.excludeBtn} ${isExcluded ? styles.excludeBtnActive : ''}`}
          onClick={() => onToggleExclude(chunk.index)}
          title={isExcluded ? 'Include chunk' : 'Exclude chunk from processing'}
        >
          {isExcluded ? '↩' : '×'}
        </button>
      </div>,
    );
  }

  const activeCount = stats.chunkCount - excludedChunkIndices.size;

  return (
    <>
      {showControls && (
        <>
          <div className={styles.statsGrid}>
            {[
              { label: 'Chunks', value: activeCount.toLocaleString(), unit: excludedChunkIndices.size > 0 ? `/ ${stats.chunkCount}` : '' },
              { label: 'Tokens', value: (stats.tokenTotal / 1000).toFixed(1), unit: 'k total' },
              { label: 'Sections', value: String(stats.chapterCount), unit: '' },
              { label: 'Words', value: (stats.wordCount / 1000).toFixed(1), unit: 'k' },
              { label: 'Token range', value: `${stats.tokenMin}–${stats.tokenMax}`, unit: '' },
              { label: 'Est. LLM calls', value: String(stats.estimatedAbstractCalls), unit: '' },
            ].map(({ label, value, unit }) => (
              <div key={label} className={styles.statCard}>
                <div className={styles.statLabel}>{label}</div>
                <div className={styles.statValue}>
                  {value}
                  {unit && <span className={styles.statUnit}> {unit}</span>}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            className={styles.advancedToggle}
            onClick={() => setShowOptions((v) => !v)}
          >
            <span>⚙ Chunking options</span>
            <span className={styles.advancedToggleHint}>adjust if preview looks incorrect</span>
            <span className={styles.advancedToggleArrow}>{showOptions ? '▲' : '▼'}</span>
          </button>
          {showOptions && optionsPanel}

          <div className={styles.qualityNote}>
            Source material quality matters. If chunks look garbled, cut off mid-sentence, or don&apos;t align
            with chapter boundaries, tweaking the options above may help — but there&apos;s a limit to what
            chunking can fix. Poorly structured input (bad PDF exports, OCR artefacts, missing whitespace)
            affects abstract quality and RAG retrieval. If the preview doesn&apos;t look right after adjusting
            options, consider preprocessing the file before re-uploading.
            {excludedChunkIndices.size > 0 && (
              <> <strong>{excludedChunkIndices.size} chunk{excludedChunkIndices.size !== 1 ? 's' : ''} excluded</strong> — click × again to restore.</>
            )}
          </div>
        </>
      )}

      <div className={styles.bookSpine} ref={spineRef}>
        {rows}
        {hasMore && (
          <div className={styles.loadMoreRow}>
            <button
              className={styles.loadMoreBtn}
              onClick={() => setVisible((v) => v + PREVIEW_PAGE)}
            >
              Load {Math.min(PREVIEW_PAGE, stats.chunks.length - visible)} more…
            </button>
            <button
              className={styles.loadMoreBtn}
              onClick={() => { setVisible(stats.chunks.length); setPendingScrollToBottom(true); }}
            >
              Jump to end ↓
            </button>
          </div>
        )}
        {!hasMore && stats.chunks.length > PREVIEW_PAGE && (
          <div className={styles.spineEnd}>All {stats.chunks.length} chunks shown</div>
        )}
      </div>
    </>
  );
}
