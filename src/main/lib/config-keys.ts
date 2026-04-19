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

export function llmApiKeyStorageKey(provider: LlmProvider): string {
  return `${LLM_API_KEY_PREFIX}${provider}`;
}

export function rerankerModelStorageKey(provider: LlmProvider): string {
  return `${RERANKER_MODEL_PREFIX}${provider}`;
}

export function isLlmApiKeyRowKey(key: string): boolean {
  return key === CONFIG_KEY.legacyLlmApiKey || key.startsWith(LLM_API_KEY_PREFIX);
}
