export enum LlmProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Ollama = 'ollama',
  LmStudio = 'lmstudio',
}

export interface LlmConfig {
  provider: LlmProvider | null;
  apiKey: string; // always empty in GET responses; full value accepted on PUT
  /** Per-provider key presence — true means a non-empty key is stored for that provider. */
  keysSet: Partial<Record<LlmProvider, boolean>>;
  model: string;
  embeddingModel: string;
  ollamaBaseUrl: string;
  lmStudioBaseUrl: string;
}

export interface LlmStatus {
  configured: boolean;
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';

export type TitleStatus = 'pending' | 'determined' | 'locked';

export interface Chat {
  id: string;
  title: string;
  titleStatus: TitleStatus;
  createdAt: string;
  updatedAt: string;
}

/** Library coverage hints for chat (system prompt + RAG). */
export interface ChatContextAvailability {
  bookCount: number;
  seriesAbstractMissingCount: number;
  seriesAbstractNotApplicable: boolean;
  /** Series that contain ≥1 book (global); 1 when scoped to a valid series. */
  seriesBucketCount: number;
  bookAbstractMissingCount: number;
  /** Books with chunkCount > 0 — RAG can apply once embedded. */
  ragEligibleBookCount: number;
  ragEmbeddingMissingCount: number;
  /** Books with embeddings from a different model than the current one (no override). */
  ragModelMismatchCount: number;
  /** True when counts are limited to a single series (sidebar selection). */
  seriesScoped?: boolean;
}

export type ChatRole = 'user' | 'assistant' | 'compaction';

export interface ChatMessage {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  llmCallId: string | null;
  chunksReferenced: string[];
  createdAt: string;
}

export type LlmCallPurpose = 'chat' | 'title' | 'abstract' | 'rag' | 'rerank' | 'compact';

export interface LlmCall {
  id: string;
  chatId: string | null;
  purpose: LlmCallPurpose;
  provider: string | null;
  model: string | null;
  requestJson: string;
  responseText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AppLogEntry {
  time: number; // epoch ms
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

// ── Abstract generation config ────────────────────────────────────────────────

export const DEFAULT_ABSTRACT_TOKENS = {
  detailed: 4000,
  short: 2000,
  book: 1500,
} as const;

/** 1 = concise, 2 = default, 3 = exhaustive */
export const DEFAULT_ABSTRACT_DETAIL_LEVEL = 2;

export interface AbstractConfig {
  maxTokensDetailed: number;
  maxTokensShort: number;
  maxTokensBook: number;
  /** 1 = concise, 2 = default, 3 = exhaustive */
  detailLevel: number;
}

// ── Reranker config ──────────────────────────────────────────────────────────

/** Providers that expose a dedicated rerank endpoint. */
export const RERANKER_CAPABLE_PROVIDERS: LlmProvider[] = [
  LlmProvider.Ollama,
  LlmProvider.OpenRouter,
];

export interface RerankerConfig {
  /** Cross-encoder model name, stored per-provider (e.g. bge-reranker-v2-m3 / cohere/rerank-v3.5). */
  model: string;
  /** Whether reranking is applied in chat retrieval. */
  enabled: boolean;
  /**
   * Multiplier applied to MERGED_TOP_N before reranking.
   * E.g. 2.0 → retrieve 2× candidates, then rerank down to MERGED_TOP_N.
   */
  topKMultiplier: number;
}

export const DEFAULT_RERANKER_CONFIG: RerankerConfig = {
  model: '',
  enabled: false,
  topKMultiplier: 2.0,
};

// ── Chunking options ─────────────────────────────────────────────────────────

export interface EpubOptions {
  /** CSS selectors — matching elements are stripped from EPUB HTML before text extraction. */
  boilerplateSelectors: string[];
  /** Case-insensitive regex strings — TOC entries matching any are skipped entirely. */
  skipLabelPatterns: string[];
  /** Case-insensitive regex strings — TOC entries must match at least one to be included as a chapter. */
  includeLabelPatterns: string[];
}

export const DEFAULT_EPUB_OPTIONS: EpubOptions = {
  boilerplateSelectors: [
    'img', 'svg', 'picture', 'object', 'iframe', 'script', 'style', 'noscript', 'figure',
    "aside[type='footnote']", "aside[type='footnotes']",
    "[role='doc-endnotes']", "[role='doc-noteref']",
    '.pg-header', '.pg-footer', "[class*='pg-header']", "[class*='pg-footer']",
    '#pg-header', '#pg-footer', "nav[type='toc']",
  ],
  skipLabelPatterns: [
    '^(cover|contents|table of contents|copyright|project gutenberg|title page|the millennium fulcrum|about this book|illustrations|metadata|license|credit)',
  ],
  includeLabelPatterns: [
    '\\bchapter\\b',
    '\\b(part|book)\\s+[ivxlcdm\\d]+\\b',
    '^\\d+[.)]\\s+',
  ],
};

export interface ChunkingOptions {
  /** Regex strings (case-insensitive) tested per trimmed line to detect chapter boundaries.
   *  Markdown headings (##) are always detected regardless of this list.
   *  When undefined, defaults to ALL-CAPS line detection. */
  chapterPatterns?: string[];
  /** Regex strings for additional paragraph separators beyond blank lines.
   *  Matching lines are consumed (not included in chunk text). */
  sectionSeparators?: string[];
  /** Minimum token count to keep a paragraph as a chunk. Default: 3. */
  minTokens?: number;
  /** Maximum token count before a paragraph is split at sentence boundaries. Default: 600. */
  maxTokens?: number;
  /** When > 0, chunks below this token count are merged into the adjacent chunk within the same chapter. Default: 100. */
  mergeThreshold?: number;
  /** EPUB-specific extraction options. Only used when the source file is an .epub. */
  epubOptions?: EpubOptions;
}

// ── Book ingestion ────────────────────────────────────────────────────────────

export interface Series {
  id: string;
  title: string;
  description?: string;
  abstract?: string;
  abstractedAt?: string;
  bookCount: number;
  createdAt: string;
}

export interface Book {
  id: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  author?: string;
  year?: number;
  genre?: string;
  filePath: string;
  wordCount: number;
  chunkCount: number;
  language?: string;
  ingestedAt?: string;
  abstractedAt?: string;
  embeddedAt?: string;
  embeddingModel?: string;
  embeddingModelOverride?: boolean;
  createdAt: string;
}

export interface EmbeddingSearchResult {
  chunkId: string;
  score: number;
  text: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
  source: 'chunk' | 'abstract';
  abstractLevel?: 'chapter_detailed' | 'chapter_short' | 'book';
}

export interface Abstract {
  id: string;
  bookId: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
  level: 'chapter_detailed' | 'chapter_short' | 'book';
  content: string;
  createdAt: string;
}

export interface ChunkView {
  index: number;
  chapterNumber: number | null;
  chapterTitle: string | null;
  tokenCount: number;
  rawText: string;
}

export interface BookStats {
  chunkCount: number;
  tokenMin: number;
  tokenMax: number;
  tokenTotal: number;
  chapterCount: number;
  wordCount: number;
  estimatedAbstractCalls: number;
  chunks: ChunkView[];
}

// ── Background jobs ───────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'error' | 'dismissed';
export type JobType = 'abstract_generation' | 'embedding_generation';

export interface Job {
  id: string;
  type: JobType;
  bookId: string;
  bookTitle: string;
  status: JobStatus;
  progressCurrent: number;
  progressTotal: number;
  progressLabel: string;
  error?: string;
  model?: string;
  startedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface StatsOverview {
  chats: number;
  messagesUser: number;
  messagesAssistant: number;
  llmCallsTotal: number;
  llmCallsError: number;
  series: number;
  books: number;
  chunks: number;
  abstracts: number;
  totalWords: number;
  dbSizeBytes: number;
  /** Approximate — sum of raw vector JSON lengths in the DB. */
  ragSizeBytes: number;
  logSizeBytes: number;
}

export interface LlmStatRow {
  key: string;
  subKey: string | null;
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
}

export interface StatsPayload {
  overview: StatsOverview;
  byPurpose: LlmStatRow[];
  byModel: LlmStatRow[];
}

/** Persisted per-model token pricing. Key = model name. */
export type CostPrices = Record<string, { input: number; output: number }>;

export interface ImportResult {
  seriesId: string;
  seriesTitle: string;
  books: Array<{ id: string; title: string; warning?: string }>;
  schemaWarning?: string;
}

/**
 * Static model lists used as fallback when a provider has no list API,
 * and as the authoritative list for providers like Anthropic.
 * Add new models here when they are released.
 */
export const PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  [LlmProvider.Anthropic]: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
  ],
  [LlmProvider.OpenAI]: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'o1',
    'o1-mini',
    'o3-mini',
  ],
  // Dynamic providers — list fetched at runtime via their APIs.
  [LlmProvider.OpenRouter]: [],
  [LlmProvider.Ollama]: [],
  [LlmProvider.LmStudio]: [],
};
