import { LlmProvider } from '@shared/types';

/** Stored `config` row keys — single source of truth to avoid silent typos. */
export const CONFIG_KEY = {
  /** SQLite / app schema bump (structural migrations in database.ts). */
  schemaVersion: 'schema_version',
  /** Logical key-value schema for `config` rows — bump when renaming keys (see config-migrations.ts). */
  configKvVersion: 'config_kv_version',
  llmProvider: 'llm_provider',
  llmModel: 'llm_model',
  embeddingModel: 'embedding_model',
  embeddingQueryPrefix: 'embedding_query_prefix',
  embeddingPassagePrefix: 'embedding_passage_prefix',
  llmOllamaBaseUrl: 'llm_ollama_base_url',
  llmLmStudioBaseUrl: 'llm_lmstudio_base_url',
  /** Legacy single global key; migrated to per-provider keys. */
  legacyLlmApiKey: 'llm_api_key',
  abstractMaxTokensDetailed: 'abstract_max_tokens_detailed',
  abstractMaxTokensShort: 'abstract_max_tokens_short',
  abstractMaxTokensBook: 'abstract_max_tokens_book',
  abstractDetailLevel: 'abstract_detail_level',
  rerankerEnabled: 'reranker_enabled',
  rerankerTopKMultiplier: 'reranker_top_k_multiplier',
} as const;

const LLM_API_KEY_PREFIX = 'llm_api_key_';
const RERANKER_MODEL_PREFIX = 'reranker_model_';
const LLM_TEMPERATURE_PREFIX = 'llm_temperature_';
const LLM_TOP_P_PREFIX = 'llm_top_p_';
const LLM_TOP_K_PREFIX = 'llm_top_k_';
const LLM_MODEL_PREFIX = 'llm_model_';
const LLM_EMBEDDING_MODEL_PREFIX = 'llm_embedding_model_';

export function llmApiKeyStorageKey(provider: LlmProvider): string {
  return `${LLM_API_KEY_PREFIX}${provider}`;
}

export function rerankerModelStorageKey(provider: LlmProvider): string {
  return `${RERANKER_MODEL_PREFIX}${provider}`;
}

export function llmTemperatureStorageKey(provider: LlmProvider): string {
  return `${LLM_TEMPERATURE_PREFIX}${provider}`;
}

export function llmTopPStorageKey(provider: LlmProvider): string {
  return `${LLM_TOP_P_PREFIX}${provider}`;
}

export function llmTopKStorageKey(provider: LlmProvider): string {
  return `${LLM_TOP_K_PREFIX}${provider}`;
}

export function llmModelStorageKey(provider: LlmProvider): string {
  return `${LLM_MODEL_PREFIX}${provider}`;
}

export function llmEmbeddingModelStorageKey(provider: LlmProvider): string {
  return `${LLM_EMBEDDING_MODEL_PREFIX}${provider}`;
}

export function isLlmApiKeyRowKey(key: string): boolean {
  return key === CONFIG_KEY.legacyLlmApiKey || key.startsWith(LLM_API_KEY_PREFIX);
}
