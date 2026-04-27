import { getDb } from './database';
import { decryptSensitiveStored, encryptValue, isEncryptionReady } from '../lib/safe-storage';
import {
  CONFIG_KEY,
  isLlmApiKeyRowKey,
  llmApiKeyStorageKey,
  llmTopKStorageKey,
  llmTopPStorageKey,
  llmTemperatureStorageKey,
  rerankerModelStorageKey,
} from '../lib/config-keys';
import {
  AbstractConfig,
  DEFAULT_ABSTRACT_DETAIL_LEVEL,
  DEFAULT_ABSTRACT_TOKENS,
  DEFAULT_LMSTUDIO_URL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_RERANKER_CONFIG,
  LlmConfig,
  LlmProvider,
  PROVIDER_TEMPERATURE_MAX,
  RerankerConfig,
} from '@shared/types';

const DEFAULT_EMBEDDING_MODELS: Partial<Record<LlmProvider, string>> = {
  [LlmProvider.OpenAI]: 'text-embedding-3-small',
  [LlmProvider.OpenRouter]: 'text-embedding-3-small',
  [LlmProvider.LmStudio]: 'text-embedding-3-small',
  [LlmProvider.Ollama]: 'nomic-embed-text',
};

function readRaw(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

export function getConfigValue(key: string): string | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  if (!isLlmApiKeyRowKey(key)) return raw;
  const { plaintext, legacyPlain } = decryptSensitiveStored(raw);
  if (legacyPlain && isEncryptionReady() && plaintext) {
    writeRaw(key, encryptValue(plaintext));
  }
  return plaintext;
}

export function setConfigValue(key: string, value: string): void {
  const stored = isLlmApiKeyRowKey(key) ? encryptValue(value) : value;
  writeRaw(key, stored);
}

function parseProvider(value: string | null): LlmProvider | null {
  if (!value) return null;
  const match = Object.values(LlmProvider).find((p) => p === value);
  return match ?? null;
}

export function getLlmConfig(): LlmConfig {
  const provider = parseProvider(getConfigValue(CONFIG_KEY.llmProvider));
  const storedEmbeddingModel = getConfigValue(CONFIG_KEY.embeddingModel);
  const embeddingModel =
    storedEmbeddingModel ?? (provider ? (DEFAULT_EMBEDDING_MODELS[provider] ?? '') : '');

  const keysSet: Partial<Record<LlmProvider, boolean>> = {};
  for (const p of Object.values(LlmProvider)) {
    if ((getConfigValue(llmApiKeyStorageKey(p)) ?? '').length > 0) keysSet[p] = true;
  }
  const temperatures: Partial<Record<LlmProvider, number>> = {};
  for (const p of Object.values(LlmProvider)) {
    const raw = getConfigValue(llmTemperatureStorageKey(p));
    if (raw === null) continue;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      temperatures[p] = Math.min(PROVIDER_TEMPERATURE_MAX[p], Math.max(0, parsed));
    }
  }
  const topPs: Partial<Record<LlmProvider, number>> = {};
  for (const p of Object.values(LlmProvider)) {
    const raw = getConfigValue(llmTopPStorageKey(p));
    if (raw === null) continue;
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      topPs[p] = Math.min(1, Math.max(0, parsed));
    }
  }
  const topKs: Partial<Record<LlmProvider, number>> = {};
  for (const p of Object.values(LlmProvider)) {
    const raw = getConfigValue(llmTopKStorageKey(p));
    if (raw === null) continue;
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      topKs[p] = parsed;
    }
  }

  return {
    provider,
    apiKey: '',
    keysSet,
    model: getConfigValue(CONFIG_KEY.llmModel) ?? '',
    embeddingModel,
    embeddingQueryPrefix: getConfigValue(CONFIG_KEY.embeddingQueryPrefix) ?? '',
    embeddingPassagePrefix: getConfigValue(CONFIG_KEY.embeddingPassagePrefix) ?? '',
    ollamaBaseUrl: getConfigValue(CONFIG_KEY.llmOllamaBaseUrl) ?? DEFAULT_OLLAMA_URL,
    lmStudioBaseUrl: getConfigValue(CONFIG_KEY.llmLmStudioBaseUrl) ?? DEFAULT_LMSTUDIO_URL,
    temperatures,
    topPs,
    topKs,
  };
}

export function getEmbeddingModel(): string {
  const stored = getConfigValue(CONFIG_KEY.embeddingModel);
  if (stored) return stored;
  const provider = parseProvider(getConfigValue(CONFIG_KEY.llmProvider));
  return provider ? (DEFAULT_EMBEDDING_MODELS[provider] ?? '') : '';
}

export function getEmbeddingQueryPrefix(): string {
  return getConfigValue(CONFIG_KEY.embeddingQueryPrefix) ?? '';
}

export function getEmbeddingPassagePrefix(): string {
  return getConfigValue(CONFIG_KEY.embeddingPassagePrefix) ?? '';
}

export interface LlmConfigInput {
  provider: LlmProvider;
  apiKey?: string; // if omitted or empty, existing key is kept
  model: string;
  embeddingModel?: string;
  embeddingQueryPrefix?: string;
  embeddingPassagePrefix?: string;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
  /** null deletes stored value for provider, falling back to provider native default. */
  temperature?: number | null;
  /** null deletes stored value, falling back to provider default. */
  topP?: number | null;
  /** null deletes stored value, falling back to provider default. */
  topK?: number | null;
}

export function saveLlmConfig(input: LlmConfigInput): void {
  setConfigValue(CONFIG_KEY.llmProvider, input.provider);
  setConfigValue(CONFIG_KEY.llmModel, input.model);
  if (input.embeddingModel !== undefined) {
    setConfigValue(CONFIG_KEY.embeddingModel, input.embeddingModel);
  }
  if (input.embeddingQueryPrefix !== undefined) {
    setConfigValue(CONFIG_KEY.embeddingQueryPrefix, input.embeddingQueryPrefix);
  }
  if (input.embeddingPassagePrefix !== undefined) {
    setConfigValue(CONFIG_KEY.embeddingPassagePrefix, input.embeddingPassagePrefix);
  }
  if (input.ollamaBaseUrl !== undefined) {
    setConfigValue(CONFIG_KEY.llmOllamaBaseUrl, input.ollamaBaseUrl);
  }
  if (input.lmStudioBaseUrl !== undefined) {
    setConfigValue(CONFIG_KEY.llmLmStudioBaseUrl, input.lmStudioBaseUrl);
  }
  if (input.apiKey !== undefined && input.apiKey.length > 0) {
    setConfigValue(llmApiKeyStorageKey(input.provider), input.apiKey);
  }
  if (input.temperature !== undefined) {
    const key = llmTemperatureStorageKey(input.provider);
    if (input.temperature === null) {
      getDb().prepare('DELETE FROM config WHERE key = ?').run(key);
    } else {
      const clamped = Math.min(PROVIDER_TEMPERATURE_MAX[input.provider], Math.max(0, input.temperature));
      setConfigValue(key, String(clamped));
    }
  }
  if (input.topP !== undefined) {
    const key = llmTopPStorageKey(input.provider);
    if (input.topP === null) {
      getDb().prepare('DELETE FROM config WHERE key = ?').run(key);
    } else {
      setConfigValue(key, String(Math.min(1, Math.max(0, input.topP))));
    }
  }
  if (input.topK !== undefined) {
    const key = llmTopKStorageKey(input.provider);
    if (input.topK === null) {
      getDb().prepare('DELETE FROM config WHERE key = ?').run(key);
    } else {
      setConfigValue(key, String(Math.max(0, Math.round(input.topK))));
    }
  }
}

export function getAbstractConfig(): AbstractConfig {
  const detailed = parseInt(getConfigValue(CONFIG_KEY.abstractMaxTokensDetailed) ?? '', 10);
  const short = parseInt(getConfigValue(CONFIG_KEY.abstractMaxTokensShort) ?? '', 10);
  const book = parseInt(getConfigValue(CONFIG_KEY.abstractMaxTokensBook) ?? '', 10);
  const detailLevel = parseInt(getConfigValue(CONFIG_KEY.abstractDetailLevel) ?? '', 10);
  return {
    maxTokensDetailed: Number.isFinite(detailed) && detailed > 0 ? detailed : DEFAULT_ABSTRACT_TOKENS.detailed,
    maxTokensShort: Number.isFinite(short) && short > 0 ? short : DEFAULT_ABSTRACT_TOKENS.short,
    maxTokensBook: Number.isFinite(book) && book > 0 ? book : DEFAULT_ABSTRACT_TOKENS.book,
    detailLevel: Number.isFinite(detailLevel) && detailLevel >= 1 && detailLevel <= 3 ? detailLevel : DEFAULT_ABSTRACT_DETAIL_LEVEL,
  };
}

export function saveAbstractConfig(cfg: AbstractConfig): void {
  setConfigValue(CONFIG_KEY.abstractMaxTokensDetailed, String(cfg.maxTokensDetailed));
  setConfigValue(CONFIG_KEY.abstractMaxTokensShort, String(cfg.maxTokensShort));
  setConfigValue(CONFIG_KEY.abstractMaxTokensBook, String(cfg.maxTokensBook));
  setConfigValue(CONFIG_KEY.abstractDetailLevel, String(cfg.detailLevel));
}

export function getRerankerConfig(): RerankerConfig {
  const provider = parseProvider(getConfigValue(CONFIG_KEY.llmProvider));
  const model = provider ? (getConfigValue(rerankerModelStorageKey(provider)) ?? '') : '';
  const enabled = getConfigValue(CONFIG_KEY.rerankerEnabled) === 'true';
  const mult = parseFloat(getConfigValue(CONFIG_KEY.rerankerTopKMultiplier) ?? '');
  return {
    model,
    enabled,
    topKMultiplier: Number.isFinite(mult) && mult >= 1 ? mult : DEFAULT_RERANKER_CONFIG.topKMultiplier,
  };
}

export function saveRerankerConfig(cfg: RerankerConfig): void {
  const provider = parseProvider(getConfigValue(CONFIG_KEY.llmProvider));
  if (provider) setConfigValue(rerankerModelStorageKey(provider), cfg.model);
  setConfigValue(CONFIG_KEY.rerankerEnabled, String(cfg.enabled));
  setConfigValue(CONFIG_KEY.rerankerTopKMultiplier, String(cfg.topKMultiplier));
}

export function isLlmConfigured(): boolean {
  const provider = parseProvider(getConfigValue(CONFIG_KEY.llmProvider));
  if (!provider) return false;
  const model = getConfigValue(CONFIG_KEY.llmModel) ?? '';
  if (!model) return false;
  if (provider === LlmProvider.Ollama) {
    return (getConfigValue(CONFIG_KEY.llmOllamaBaseUrl) ?? '').length > 0;
  }
  if (provider === LlmProvider.LmStudio) {
    return (getConfigValue(CONFIG_KEY.llmLmStudioBaseUrl) ?? '').length > 0;
  }
  return (getConfigValue(llmApiKeyStorageKey(provider)) ?? '').length > 0;
}

/** Returns the stored API key for the currently active provider. */
export function getApiKeyPlaintext(): string {
  const provider = parseProvider(getConfigValue(CONFIG_KEY.llmProvider));
  if (!provider) return '';
  return getConfigValue(llmApiKeyStorageKey(provider)) ?? '';
}

/** Returns the stored API key for a specific provider (used for model listing before saving). */
export function getApiKeyForProvider(provider: LlmProvider): string {
  return getConfigValue(llmApiKeyStorageKey(provider)) ?? '';
}
