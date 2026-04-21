import { DragEvent, useEffect, useRef, useState } from 'react';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { bookApi } from '../../api/book-api';
import { seriesApi } from '../../api/series-api';
import type { BookStats, ChunkingOptions, EpubOptions, Series } from '@shared/types';
import {
  DEFAULT_EPUB_OPTIONS,
  DEFAULT_MAX_PARAGRAPHS_PER_CHAPTER_SECTION,
  DEFAULT_MERGE_THRESHOLD,
} from '@shared/types';
import { resolveDroppedFilePath } from '../../utils/dndFilePath';
import type { ChunkingUIState } from './chunking-types';
import { CHAPTER_PRESETS, SECTION_PRESETS } from './constants';
import { StepEpub } from './steps/StepEpub';
import { StepFile } from './steps/StepFile';
import { StepMeta } from './steps/StepMeta';
import { StepPreview } from './steps/StepPreview';
import { StepProcessing } from './steps/StepProcessing';
import { StepSeries } from './steps/StepSeries';
import styles from './IngestWizard.module.css';

interface Props {
  onClose: () => void;
  onDone: () => void;
  initialSeriesId?: string;
}

type StepKey = 'series' | 'file' | 'epub' | 'preview' | 'meta' | 'processing';

const STEP_LABELS: Record<StepKey, string> = {
  series: 'Series',
  file: 'Select file',
  epub: 'EPUB options',
  preview: 'Preview',
  meta: 'Metadata',
  processing: 'Processing',
};

function isBookFilename(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith('.txt') || n.endsWith('.md') || n.endsWith('.epub');
}

export function IngestWizard({ onClose, onDone, initialSeriesId }: Props) {
  const [step, setStep] = useState<StepKey>('series');

  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(initialSeriesId ?? null);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [seriesLoading, setSeriesLoading] = useState(true);

  const [filePath, setFilePath] = useState<string | null>(null);

  const [epubBoilerplateSelectors, setEpubBoilerplateSelectors] = useState<string[]>(
    DEFAULT_EPUB_OPTIONS.boilerplateSelectors,
  );
  const [epubSkipLabelPatterns, setEpubSkipLabelPatterns] = useState<string[]>(
    DEFAULT_EPUB_OPTIONS.skipLabelPatterns,
  );
  const [epubIncludeLabelPatterns, setEpubIncludeLabelPatterns] = useState<string[]>(
    DEFAULT_EPUB_OPTIONS.includeLabelPatterns,
  );

  const [stats, setStats] = useState<BookStats | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [excludedChunkIndices, setExcludedChunkIndices] = useState<Set<number>>(new Set());
  const [chapterTitleOverrides, setChapterTitleOverrides] = useState<Map<number, string>>(new Map());

  const [chapterPresets, setChapterPresets] = useState<Set<string>>(new Set(['markdown', 'allcaps']));
  const [chapterCustoms, setChapterCustoms] = useState<string[]>([]);
  const [sectionPresets, setSectionPresets] = useState<Set<string>>(new Set());
  const [sectionCustoms, setSectionCustoms] = useState<string[]>([]);
  const [excludePatterns, setExcludePatterns] = useState<string[]>([]);
  const [minTokens, setMinTokens] = useState(3);
  const [maxTokens, setMaxTokens] = useState(600);
  const [mergeThreshold, setMergeThreshold] = useState(DEFAULT_MERGE_THRESHOLD);
  const [mergeThresholdCommitted, setMergeThresholdCommitted] = useState(DEFAULT_MERGE_THRESHOLD);
  const mergeThresholdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [maxParagraphsPerChapterSection, setMaxParagraphsPerChapterSection] = useState(
    DEFAULT_MAX_PARAGRAPHS_PER_CHAPTER_SECTION,
  );
  const [maxParagraphsPerChapterSectionCommitted, setMaxParagraphsPerChapterSectionCommitted] =
    useState(DEFAULT_MAX_PARAGRAPHS_PER_CHAPTER_SECTION);
  const maxParasTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMergeThresholdChange(v: number) {
    setMergeThreshold(v);
    if (mergeThresholdTimer.current) clearTimeout(mergeThresholdTimer.current);
    mergeThresholdTimer.current = setTimeout(() => setMergeThresholdCommitted(v), 1500);
  }

  function handleMergeThresholdBlur() {
    if (mergeThresholdTimer.current) clearTimeout(mergeThresholdTimer.current);
    setMergeThresholdCommitted(mergeThreshold);
  }

  function handleMaxParagraphsPerChapterSectionChange(v: number) {
    setMaxParagraphsPerChapterSection(v);
    if (maxParasTimer.current) clearTimeout(maxParasTimer.current);
    maxParasTimer.current = setTimeout(() => setMaxParagraphsPerChapterSectionCommitted(v), 1500);
  }

  function handleMaxParagraphsPerChapterSectionBlur() {
    if (maxParasTimer.current) clearTimeout(maxParasTimer.current);
    setMaxParagraphsPerChapterSectionCommitted(maxParagraphsPerChapterSection);
  }

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [year, setYear] = useState('');
  const [genre, setGenre] = useState('');
  const [language, setLanguage] = useState('');

  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set(['abstract_generation']));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(modalRef);
  const skipNextDropZoneClick = useRef(false);


  const isEpub = !!filePath?.toLowerCase().endsWith('.epub');

  const steps: StepKey[] = isEpub
    ? ['series', 'file', 'epub', 'preview', 'meta', 'processing']
    : ['series', 'file', 'preview', 'meta', 'processing'];
  const stepIndex = steps.indexOf(step);
  const totalSteps = steps.length;

  useEffect(() => {
    seriesApi.list().then((list) => {
      setSeriesList(list);
      setSeriesLoading(false);
    });
  }, []);

  const epubOptions: EpubOptions | undefined = isEpub
    ? {
        boilerplateSelectors: epubBoilerplateSelectors,
        skipLabelPatterns: epubSkipLabelPatterns,
        includeLabelPatterns: epubIncludeLabelPatterns,
      }
    : undefined;

  const chunkingOptions: ChunkingOptions = {
    chapterPatterns: [
      ...CHAPTER_PRESETS.filter((p) => chapterPresets.has(p.id)).map((p) => p.pattern),
      ...chapterCustoms,
    ],
    sectionSeparators: [
      ...SECTION_PRESETS.filter((p) => sectionPresets.has(p.id)).map((p) => p.pattern),
      ...sectionCustoms,
    ],
    excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
    minTokens,
    maxTokens,
    mergeThreshold,
    maxParagraphsPerChapterSection,
    ...(epubOptions && { epubOptions }),
  };

  useEffect(() => {
    if (!filePath) return;
    const isEpubFile = filePath.toLowerCase().endsWith('.epub');
    const opts: ChunkingOptions = {
      chapterPatterns: [
        ...CHAPTER_PRESETS.filter((p) => chapterPresets.has(p.id)).map((p) => p.pattern),
        ...chapterCustoms,
      ],
      sectionSeparators: [
        ...SECTION_PRESETS.filter((p) => sectionPresets.has(p.id)).map((p) => p.pattern),
        ...sectionCustoms,
      ],
      excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
      minTokens,
      maxTokens,
      mergeThreshold,
      maxParagraphsPerChapterSection: maxParagraphsPerChapterSectionCommitted,
      ...(isEpubFile && {
        epubOptions: {
          boilerplateSelectors: epubBoilerplateSelectors,
          skipLabelPatterns: epubSkipLabelPatterns,
          includeLabelPatterns: epubIncludeLabelPatterns,
        },
      }),
    };
    setPreviewLoading(true);
    setPreviewError(null);
    setStats(null);
    setExcludedChunkIndices(new Set());
    setChapterTitleOverrides(new Map());
    bookApi
      .preview(filePath, opts)
      .then(({ stats: s, suggestedTitle: t, detectedLanguage: lang }) => {
        setStats(s);
        if (!title) setTitle(t);
        if (!language) setLanguage(lang);
      })
      .catch((e: Error) => setPreviewError(e.message))
      .finally(() => setPreviewLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, chapterPresets, chapterCustoms, sectionPresets, sectionCustoms, excludePatterns, minTokens, maxTokens, mergeThresholdCommitted, maxParagraphsPerChapterSectionCommitted, epubBoilerplateSelectors, epubSkipLabelPatterns, epubIncludeLabelPatterns]);

  function toggleChapterPreset(id: string) {
    setChapterPresets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addChapterCustom(v: string) {
    setChapterCustoms((prev) => (prev.includes(v) ? prev : [...prev, v]));
  }

  function removeChapterCustom(v: string) {
    setChapterCustoms((prev) => prev.filter((x) => x !== v));
  }

  function toggleSectionPreset(id: string) {
    setSectionPresets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addSectionCustom(v: string) {
    setSectionCustoms((prev) => (prev.includes(v) ? prev : [...prev, v]));
  }

  function removeSectionCustom(v: string) {
    setSectionCustoms((prev) => prev.filter((x) => x !== v));
  }

  function addExcludePattern(v: string) {
    setExcludePatterns((prev) => (prev.includes(v) ? prev : [...prev, v]));
  }

  function removeExcludePattern(v: string) {
    setExcludePatterns((prev) => prev.filter((x) => x !== v));
  }

  const chunkingUIState: ChunkingUIState = {
    chapterPresets,
    chapterCustoms,
    sectionPresets,
    sectionCustoms,
    excludePatterns,
    minTokens,
    maxTokens,
    onToggleChapterPreset: toggleChapterPreset,
    onChapterCustomAdd: addChapterCustom,
    onChapterCustomRemove: removeChapterCustom,
    onToggleSectionPreset: toggleSectionPreset,
    onSectionCustomAdd: addSectionCustom,
    onSectionCustomRemove: removeSectionCustom,
    onExcludeAdd: addExcludePattern,
    onExcludeRemove: removeExcludePattern,
    onMinTokensChange: setMinTokens,
    onMaxTokensChange: setMaxTokens,
    mergeThreshold,
    onMergeThresholdChange: handleMergeThresholdChange,
    onMergeThresholdBlur: handleMergeThresholdBlur,
    maxParagraphsPerChapterSection,
    onMaxParagraphsPerChapterSectionChange: handleMaxParagraphsPerChapterSectionChange,
    onMaxParagraphsPerChapterSectionBlur: handleMaxParagraphsPerChapterSectionBlur,
  };

  function handleChapterTitleOverride(chapterNumber: number, title: string | null) {
    setChapterTitleOverrides((prev) => {
      const next = new Map(prev);
      if (title === null || title === '') {
        next.delete(chapterNumber);
      } else {
        next.set(chapterNumber, title);
      }
      return next;
    });
  }

  async function handleCreateSeries() {
    if (!newSeriesTitle.trim()) return;
    const s = await seriesApi.create(newSeriesTitle.trim());
    setSeriesList((prev) => [s, ...prev]);
    setSelectedSeriesId(s.id);
    setNewSeriesTitle('');
    setCreatingNew(false);
  }

  async function browseFile() {
    const path = await window.electronAPI.openFileDialog();
    if (path) setFilePath(path);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const path = resolveDroppedFilePath(e, isBookFilename);
    if (!path) return;
    skipNextDropZoneClick.current = true;
    setFilePath(path);
  }

  function openBrowseUnlessAfterDrop() {
    if (skipNextDropZoneClick.current) {
      skipNextDropZoneClick.current = false;
      return;
    }
    void browseFile();
  }

  function toggleJob(type: string) {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }

  function toggleExcludeChunk(index: number) {
    setExcludedChunkIndices((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  async function handleSubmit() {
    if (!filePath || !title.trim() || !selectedSeriesId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await bookApi.create({
        seriesId: selectedSeriesId,
        filePath,
        title: title.trim(),
        author: author.trim() || undefined,
        year: year ? parseInt(year, 10) : undefined,
        genre: genre.trim() || undefined,
        language: language.trim() || undefined,
        jobs: Array.from(selectedJobs),
        chunkingOptions,
        excludedChunkIndices: excludedChunkIndices.size > 0 ? Array.from(excludedChunkIndices) : undefined,
        chapterTitleOverrides: chapterTitleOverrides.size > 0
          ? Object.fromEntries(chapterTitleOverrides)
          : undefined,
      });
      onDone();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to ingest book');
      setSubmitting(false);
    }
  }

  function goNext() {
    const i = stepIndex + 1;
    if (i < steps.length) setStep(steps[i]!);
  }

  function goBack() {
    const i = stepIndex - 1;
    if (i >= 0) setStep(steps[i]!);
  }

  const canAdvance =
    (step === 'series' && !!selectedSeriesId) ||
    (step === 'file' && !!filePath) ||
    step === 'epub' ||
    (step === 'preview' && !previewLoading && !previewError && !!stats) ||
    (step === 'meta' && !!title.trim());

  return (
    <div className={styles.overlay}>
      <div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.header}>
          <span className={styles.title}>{STEP_LABELS[step]}</span>
          <span className={styles.steps}>step {stepIndex + 1} of {totalSteps}</span>
        </div>

        <div className={styles.body}>
          {step === 'series' && (
            <StepSeries
              seriesList={seriesList}
              loading={seriesLoading}
              selected={selectedSeriesId}
              onSelect={setSelectedSeriesId}
              creatingNew={creatingNew}
              newTitle={newSeriesTitle}
              onNewTitle={setNewSeriesTitle}
              onToggleNew={() => setCreatingNew((v) => !v)}
              onCreateNew={handleCreateSeries}
            />
          )}
          {step === 'file' && (
            <StepFile
              filePath={filePath}
              onDrop={handleDrop}
              onBrowse={openBrowseUnlessAfterDrop}
              fileInputRef={fileInputRef}
              onFileInput={setFilePath}
            />
          )}
          {step === 'epub' && (
            <>
              <StepEpub
                boilerplateSelectors={epubBoilerplateSelectors}
                setBoilerplateSelectors={setEpubBoilerplateSelectors}
                skipLabelPatterns={epubSkipLabelPatterns}
                setSkipLabelPatterns={setEpubSkipLabelPatterns}
                includeLabelPatterns={epubIncludeLabelPatterns}
                setIncludeLabelPatterns={setEpubIncludeLabelPatterns}
              />
              <StepPreview
                stats={stats}
                loading={previewLoading}
                error={previewError}
                chunkingState={chunkingUIState}
                excludedChunkIndices={excludedChunkIndices}
                onToggleExclude={toggleExcludeChunk}
                chapterTitleOverrides={chapterTitleOverrides}
                onChapterTitleOverride={handleChapterTitleOverride}
                showControls={false}
              />
            </>
          )}
          {step === 'preview' && (
            <StepPreview
              stats={stats}
              loading={previewLoading}
              error={previewError}
              chunkingState={chunkingUIState}
              excludedChunkIndices={excludedChunkIndices}
              onToggleExclude={toggleExcludeChunk}
              chapterTitleOverrides={chapterTitleOverrides}
              onChapterTitleOverride={handleChapterTitleOverride}
            />
          )}
          {step === 'meta' && (
            <StepMeta
              title={title} setTitle={setTitle}
              author={author} setAuthor={setAuthor}
              year={year} setYear={setYear}
              genre={genre} setGenre={setGenre}
              language={language} setLanguage={setLanguage}
            />
          )}
          {step === 'processing' && (
            <StepProcessing
              selectedJobs={selectedJobs}
              onToggle={toggleJob}
              stats={stats}
              excludedCount={excludedChunkIndices.size}
              error={submitError}
            />
          )}
        </div>

        <div className={styles.footer}>
          {stepIndex > 0 && (
            <button type="button" className={styles.btn} onClick={goBack}>
              Back
            </button>
          )}
          <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
          {step !== 'processing' ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={!canAdvance}
              onClick={goNext}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={submitting || selectedJobs.size === 0}
              onClick={handleSubmit}
            >
              {submitting ? 'Starting…' : 'Start Processing'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
