export interface ChunkingUIState {
  chapterPresets: Set<string>;
  chapterCustoms: string[];
  sectionPresets: Set<string>;
  sectionCustoms: string[];
  excludePatterns: string[];
  minTokens: number;
  maxTokens: number;
  mergeThreshold: number;
  maxParagraphsPerChapterSection: number;
  onToggleChapterPreset: (id: string) => void;
  onChapterCustomAdd: (v: string) => void;
  onChapterCustomRemove: (v: string) => void;
  onToggleSectionPreset: (id: string) => void;
  onSectionCustomAdd: (v: string) => void;
  onSectionCustomRemove: (v: string) => void;
  onExcludeAdd: (v: string) => void;
  onExcludeRemove: (v: string) => void;
  onMinTokensChange: (v: number) => void;
  onMaxTokensChange: (v: number) => void;
  onMergeThresholdChange: (v: number) => void;
  onMergeThresholdBlur: () => void;
  onMaxParagraphsPerChapterSectionChange: (v: number) => void;
  onMaxParagraphsPerChapterSectionBlur: () => void;
}
