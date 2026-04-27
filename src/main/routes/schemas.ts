import { LlmProvider } from '../../shared/types';

const providerEnum = [
  LlmProvider.Anthropic,
  LlmProvider.OpenAI,
  LlmProvider.OpenRouter,
  LlmProvider.Ollama,
  LlmProvider.LmStudio,
] as const;

export const MAX_LOG_LIMIT = 1000;

export const schemas = {
  idParam: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  chatTitleBody: {
    type: 'object',
    required: ['title'],
    properties: { title: { type: 'string', minLength: 1, maxLength: 500 } },
  },
  chatMessageBody: {
    type: 'object',
    required: ['content'],
    properties: {
      content: { type: 'string', minLength: 1 },
      seriesId: { type: 'string' },
    },
  },
  contextAvailabilityQuery: {
    type: 'object',
    properties: { seriesId: { type: 'string' } },
  },
  logsAppQuery: {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
      /** Comma-separated log levels; exact match. Empty after parse → no rows. Omit with no `level` → all levels. */
      levels: { type: 'string' },
      limit: { type: 'string' },
    },
  },
  logsLlmQuery: {
    type: 'object',
    properties: {
      limit: { type: 'string' },
      chatId: { type: 'string' },
      /** Comma-separated `LlmCallPurpose` values; omit for all purposes. */
      purposes: { type: 'string' },
    },
  },
  bookPreviewBody: {
    type: 'object',
    required: ['filePath'],
    properties: {
      filePath: { type: 'string', minLength: 1 },
      chunkingOptions: { type: 'object', additionalProperties: true },
    },
  },
  bookCreateBody: {
    type: 'object',
    required: ['seriesId', 'filePath', 'title'],
    properties: {
      seriesId: { type: 'string', minLength: 1 },
      filePath: { type: 'string', minLength: 1 },
      title: { type: 'string', minLength: 1 },
      author: { type: 'string' },
      year: { type: 'integer' },
      genre: { type: 'string' },
      language: { type: 'string' },
      jobs: {
        type: 'array',
        items: { type: 'string', enum: ['abstract_generation', 'embedding_generation'] },
      },
      chunkingOptions: { type: 'object', additionalProperties: true },
      excludedChunkIndices: { type: 'array', items: { type: 'integer' } },
      chapterTitleOverrides: { type: 'object', additionalProperties: { type: 'string' } },
    },
  },
  bookJobBody: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', enum: ['abstract_generation', 'embedding_generation'] },
      /** When `type` is `embedding_generation`, run full abstract LLM regeneration after chunk embed (skips standalone abstract-vector pass in between). */
      chainAbstractGeneration: { type: 'boolean' },
    },
  },
  bookEmbeddingSearchBody: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      n: { type: 'integer', minimum: 1, maximum: 50 },
    },
  },
  bookEmbeddingOverrideBody: {
    type: 'object',
    required: ['override'],
    properties: { override: { type: 'boolean' } },
  },
  seriesCreateBody: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string' },
    },
  },
  seriesRenameBody: {
    type: 'object',
    required: ['title'],
    properties: { title: { type: 'string', minLength: 1, maxLength: 500 } },
  },
  exportQuery: {
    type: 'object',
    properties: {
      embeddings: { type: 'string' },
    },
  },
  importQuery: {
    type: 'object',
    properties: { seriesId: { type: 'string' } },
  },
  configAbstractBody: {
    type: 'object',
    required: ['maxTokensDetailed', 'maxTokensShort', 'maxTokensBook'],
    properties: {
      maxTokensDetailed: { type: 'integer' },
      maxTokensShort: { type: 'integer' },
      maxTokensBook: { type: 'integer' },
      detailLevel: { type: 'integer' },
    },
  },
  configLlmSaveBody: {
    type: 'object',
    required: ['provider', 'model'],
    properties: {
      provider: { type: 'string', enum: [...providerEnum] },
      apiKey: { type: 'string' },
      model: { type: 'string', minLength: 1 },
      embeddingModel: { type: 'string' },
      embeddingQueryPrefix: { type: 'string' },
      embeddingPassagePrefix: { type: 'string' },
      ollamaBaseUrl: { type: 'string' },
      lmStudioBaseUrl: { type: 'string' },
      // maximum: 2 covers all providers; config-service clamps to PROVIDER_TEMPERATURE_MAX per provider
      temperature: { anyOf: [{ type: 'number', minimum: 0, maximum: 2 }, { type: 'null' }] },
      topP: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
      topK: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    },
  },
  configRerankerBody: {
    type: 'object',
    required: ['model', 'topKMultiplier'],
    properties: {
      model: { type: 'string', minLength: 1 },
      enabled: { type: 'boolean' },
      topKMultiplier: { type: 'number', minimum: 1 },
    },
  },
  configBaseUrlHealthBody: {
    type: 'object',
    required: ['kind', 'url'],
    properties: {
      kind: { type: 'string', enum: ['ollama', 'lmstudio'] },
      url: { type: 'string', minLength: 1 },
    },
  },
  configModelsBody: {
    type: 'object',
    required: ['provider'],
    properties: {
      provider: { type: 'string', enum: [...providerEnum] },
      ollamaBaseUrl: { type: 'string' },
      lmStudioBaseUrl: { type: 'string' },
      modelType: { type: 'string', enum: ['chat', 'embedding', 'reranker'] },
    },
  },
  configLoadModelBody: {
    type: 'object',
    required: ['provider', 'model'],
    properties: {
      provider: { type: 'string', enum: [...providerEnum] },
      model: { type: 'string', minLength: 1 },
      ollamaBaseUrl: { type: 'string' },
      lmStudioBaseUrl: { type: 'string' },
    },
  },
  statsCostPricesBody: {
    type: 'object',
    additionalProperties: {
      type: 'object',
      required: ['input', 'output'],
      properties: {
        input: { type: 'number' },
        output: { type: 'number' },
      },
    },
  },
} as const;
