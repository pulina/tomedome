export const CHAPTER_PRESETS = [
  { id: 'markdown', label: 'Markdown heading (##)', pattern: '^#{1,3}\\s+\\S', hint: '## Chapter One' },
  { id: 'allcaps', label: 'ALL-CAPS line', pattern: '^(?=.*[A-Z])[^a-z]{1,200}$', hint: 'CHAPTER ONE' },
  { id: 'numbered', label: 'Numbered (1. Title)', pattern: '^\\d+[.:][ \\t]', hint: '1. Chapter One' },
  { id: 'roman', label: 'Roman numerals (VIII.)', pattern: '^[IVXLCDMivxlcdm]+[.:][ \\t]', hint: 'VIII. Title' },
  { id: 'chapter_kw', label: 'Chapter keyword', pattern: '^chapter[ \\t]', hint: 'Chapter One' },
  { id: 'chapter_letter_n', label: 'Chapter/Letter N', pattern: '^(chapter|letter)\\s+\\d+', hint: 'Chapter 4 / Letter 2' },
] as const;

export const SECTION_PRESETS = [
  { id: 'hr', label: 'Horizontal rule (--- or ***)', pattern: '^[-*_]{3,}\\s*$', hint: '---' },
] as const;

export const AVAILABLE_JOBS = [
  {
    type: 'abstract_generation',
    name: 'Generate abstracts',
    desc: 'Chapter-by-chapter summaries → book abstract (pays once, stored forever)',
    disabled: false,
  },
  {
    type: 'embedding_generation',
    name: 'Generate embeddings',
    desc: 'Embed all chunks into a vector store — required for semantic search (Epic 1.5)',
    disabled: false,
  },
] as const;

export const PREVIEW_PAGE = 20;
