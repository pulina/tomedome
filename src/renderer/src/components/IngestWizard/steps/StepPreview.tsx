import { ReactNode, useEffect, useRef, useState } from 'react';
import type { BookStats } from '@shared/types';
import { CHAPTER_PRESETS, PREVIEW_PAGE, SECTION_PRESETS } from '../constants';
import type { ChunkingUIState } from '../chunking-types';
import { TagListEditor } from '../TagListEditor';
import styles from '../IngestWizard.module.css';

interface Props {
  stats: BookStats | null;
  loading: boolean;
  error: string | null;
  chunkingState: ChunkingUIState;
  excludedChunkIndices: Set<number>;
  onToggleExclude: (index: number) => void;
  chapterTitleOverrides: Map<number, string>;
  onChapterTitleOverride: (chapterNumber: number, title: string | null) => void;
  showControls?: boolean;
}

function CustomPatternInput({
  placeholder,
  title,
  onAdd,
}: {
  placeholder: string;
  title?: string;
  onAdd: (v: string) => void;
}) {
  const [input, setInput] = useState('');
  function commit() {
    const v = input.trim();
    if (v) { onAdd(v); setInput(''); }
  }
  return (
    <div className={styles.customRow}>
      <input
        className={styles.customInput}
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        spellCheck={false}
        title={title}
      />
      <button className={styles.applyBtn} onClick={commit} disabled={!input.trim()}>Add</button>
    </div>
  );
}

export function StepPreview({
  stats,
  loading,
  error,
  chunkingState,
  excludedChunkIndices,
  onToggleExclude,
  chapterTitleOverrides,
  onChapterTitleOverride,
  showControls = true,
}: Props) {
  const [visible, setVisible] = useState(PREVIEW_PAGE);
  const [showOptions, setShowOptions] = useState(false);
  const [pendingScrollToBottom, setPendingScrollToBottom] = useState(false);
  const [editingChapter, setEditingChapter] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  function toggleExpand(index: number) {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }
  const spineRef = useRef<HTMLDivElement>(null);

  function startEdit(chapterNumber: number, currentLabel: string) {
    setEditingChapter(chapterNumber);
    setEditValue(currentLabel);
  }

  function commitEdit() {
    if (editingChapter !== null) {
      onChapterTitleOverride(editingChapter, editValue.trim() || null);
      setEditingChapter(null);
    }
  }

  function cancelEdit() {
    setEditingChapter(null);
  }

  useEffect(() => { setVisible(PREVIEW_PAGE); setExpandedChunks(new Set()); }, [stats]);

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
        <div className={styles.tagList}>
          {cs.chapterCustoms.map((p) => (
            <span key={p} className={styles.tagPill}>
              <span className={styles.tagPillText}>{p}</span>
              <button
                type="button"
                className={styles.tagPillRemove}
                onClick={() => cs.onChapterCustomRemove(p)}
                title="Remove"
              >×</button>
            </span>
          ))}
        </div>
        <CustomPatternInput
          placeholder="Custom regex… e.g. ^letter\s+\d+"
          title="Matched against each line (trimmed, case-insensitive). Use ^ to anchor to line start. The matched line becomes the chapter title."
          onAdd={cs.onChapterCustomAdd}
        />
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
        <div className={styles.tagList}>
          {cs.sectionCustoms.map((p) => (
            <span key={p} className={styles.tagPill}>
              <span className={styles.tagPillText}>{p}</span>
              <button
                type="button"
                className={styles.tagPillRemove}
                onClick={() => cs.onSectionCustomRemove(p)}
                title="Remove"
              >×</button>
            </span>
          ))}
        </div>
        <CustomPatternInput
          placeholder="Custom regex… (press Enter or Add)"
          onAdd={cs.onSectionCustomAdd}
        />
      </div>

      <TagListEditor
        label="Exclude chunks"
        hint="Chunks whose text matches any of these patterns (regex, case-insensitive) are dropped from the preview and final ingest."
        items={cs.excludePatterns}
        onAdd={cs.onExcludeAdd}
        onRemove={cs.onExcludeRemove}
      />

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

      <div className={styles.advancedSection}>
        <div className={styles.advancedSectionLabel}>Long chapters</div>
        <label className={styles.tokenLabel}>
          Max paragraphs / section
          <input
            type="number"
            className={styles.tokenInput}
            value={cs.maxParagraphsPerChapterSection}
            min={0}
            max={2000}
            onChange={(e) =>
              cs.onMaxParagraphsPerChapterSectionChange(Math.max(0, parseInt(e.target.value, 10) || 0))
            }
            onBlur={() => cs.onMaxParagraphsPerChapterSectionBlur()}
          />
          <span className={styles.presetHint}>
            after merge: splits any section (including preamble) with more source paragraphs than this; same title on
            each part (0 = off)
          </span>
        </label>
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
      const chNum: number | null = chunk.chapterNumber;
      const originalLabel =
        chunk.chapterTitle ??
        (chNum !== null ? `Section ${chNum}` : 'Preamble');
      const isOverridden = chNum !== null && chapterTitleOverrides.has(chNum);
      const overrideTitle = chNum !== null ? chapterTitleOverrides.get(chNum) : undefined;
      const effectiveLabel = overrideTitle ?? originalLabel;
      const isEditing = chNum !== null && editingChapter === chNum;
      rows.push(
        <div key={`ch-${chunk.index}`} className={styles.chapterDivider}>
          {isEditing ? (
            <input
              className={styles.chapterDividerInput}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
              onBlur={commitEdit}
              autoFocus
              size={Math.max(effectiveLabel.length, 8)}
            />
          ) : (
            <span
              className={`${styles.chapterDividerLabel}${isOverridden ? ` ${styles.chapterDividerLabelOverridden}` : ''}`}
              onClick={() => chNum !== null && startEdit(chNum, effectiveLabel)}
              title={chNum !== null ? 'Click to rename' : undefined}
            >
              {effectiveLabel}{isOverridden ? ' ✎' : ''}
            </span>
          )}
        </div>,
      );
      lastChapterNumber = chNum;
    }
    const isExcluded = excludedChunkIndices.has(chunk.index);
    const isExpanded = expandedChunks.has(chunk.index);
    rows.push(
      <div
        key={chunk.index}
        className={`${styles.chunkRow} ${isExcluded ? styles.chunkRowExcluded : ''}`}
      >
        <div className={styles.chunkRowMeta}>
          <span className={styles.chunkIdx}>#{chunk.index + 1}</span>
          <span className={styles.chunkTokens}>{chunk.tokenCount}t</span>
        </div>
        <div
          className={`${styles.chunkRowText} ${isExpanded ? styles.chunkRowTextExpanded : ''}`}
          onClick={() => toggleExpand(chunk.index)}
          title={isExpanded ? 'Click to collapse' : 'Click to expand'}
        >
          {chunk.rawText}
        </div>
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
  const includedChunks = stats.chunks.filter((c) => !excludedChunkIndices.has(c.index));
  const activeSectionCount =
    includedChunks.length === 0 ? 0 : new Set(includedChunks.map((c) => c.chapterNumber)).size;
  const activeEstimatedAbstractCalls = activeSectionCount > 0 ? activeSectionCount * 2 + 1 : 0;

  const activeTokenTotal = includedChunks.reduce((a, c) => a + c.tokenCount, 0);
  const activeWordCount = includedChunks.reduce((a, c) => a + c.rawText.split(/\s+/).length, 0);
  let tokenRangeValue: string;
  let tokenRangeUnit: string;
  if (includedChunks.length === 0) {
    tokenRangeValue = '—';
    tokenRangeUnit = excludedChunkIndices.size > 0 ? `/ ${stats.tokenMin}–${stats.tokenMax}` : '';
  } else {
    const tcs = includedChunks.map((c) => c.tokenCount);
    const tmin = Math.min(...tcs);
    const tmax = Math.max(...tcs);
    tokenRangeValue = `${tmin}–${tmax}`;
    tokenRangeUnit =
      excludedChunkIndices.size > 0 && (tmin !== stats.tokenMin || tmax !== stats.tokenMax)
        ? `/ ${stats.tokenMin}–${stats.tokenMax}`
        : '';
  }

  const hasExclusions = excludedChunkIndices.size > 0;
  const activeTokenK = (activeTokenTotal / 1000).toFixed(1);
  const fullTokenK = (stats.tokenTotal / 1000).toFixed(1);
  const activeWordK = (activeWordCount / 1000).toFixed(1);
  const fullWordK = (stats.wordCount / 1000).toFixed(1);

  return (
    <>
      {showControls && (
        <>
          <div className={styles.statsGrid}>
            {[
              { label: 'Chunks', value: activeCount.toLocaleString(), unit: hasExclusions ? `/ ${stats.chunkCount}` : '' },
              {
                label: 'Tokens',
                value: activeTokenK,
                unit:
                  hasExclusions && activeTokenTotal !== stats.tokenTotal
                    ? `k / ${fullTokenK} k full`
                    : 'k total',
              },
              {
                label: 'Sections',
                value: String(activeSectionCount),
                unit:
                  hasExclusions && activeSectionCount < stats.chapterCount
                    ? `/ ${stats.chapterCount}`
                    : '',
              },
              {
                label: 'Words',
                value: activeWordK,
                unit: hasExclusions && activeWordCount !== stats.wordCount ? `k / ${fullWordK} k full` : 'k',
              },
              { label: 'Token range', value: tokenRangeValue, unit: tokenRangeUnit },
              {
                label: 'Est. LLM calls',
                value: String(activeEstimatedAbstractCalls),
                unit:
                  hasExclusions && activeEstimatedAbstractCalls !== stats.estimatedAbstractCalls
                    ? `/ ${stats.estimatedAbstractCalls}`
                    : '',
              },
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
