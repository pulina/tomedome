export interface ChunkingUIState {
  chapterPresets: Set<string>;
  chapterCustomInput: string;
  chapterCustom: string;
  sectionPresets: Set<string>;
  sectionCustomInput: string;
  sectionCustom: string;
  minTokens: number;
  maxTokens: number;
  onToggleChapterPreset: (id: string) => void;
  onChapterCustomInputChange: (v: string) => void;
  onChapterCustomCommit: () => void;
  onToggleSectionPreset: (id: string) => void;
  onSectionCustomInputChange: (v: string) => void;
  onSectionCustomCommit: () => void;
  onMinTokensChange: (v: number) => void;
  onMaxTokensChange: (v: number) => void;
  mergeThreshold: number;
  onMergeThresholdChange: (v: number) => void;
  onMergeThresholdBlur: () => void;
}
