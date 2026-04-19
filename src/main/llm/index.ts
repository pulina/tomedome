/**
 * LLM adapter factory.
 *
 * getAdapter(cfg, apiKey)         — production: builds adapter from full stored config
 * getAdapterForProvider(...)      — pre-save: builds adapter with partial / form-state params
 *
 * All adapters implement the same LlmAdapter interface — callers never
 * need to know which provider is active.
 */
import { LlmProvider, DEFAULT_OLLAMA_URL, DEFAULT_LMSTUDIO_URL } from '@shared/types';
import type { LlmConfig } from '@shared/types';
import type { LlmAdapter } from './types';
import { AnthropicAdapter } from './adapters/anthropic';
import { OpenAICompatAdapter } from './adapters/openai-compat';
import { OpenRouterAdapter } from './adapters/openrouter';
import { LmStudioAdapter } from './adapters/lmstudio';
import { OllamaAdapter } from './adapters/ollama';

export type { LlmAdapter, AdapterStreamOptions, AdapterResult, Message, MessageRole, ToolDefinition, ToolCall, AgentMessage, AdapterCallOptions, CallResult } from './types';
export { ThinkFilter, stripThinkBlocks } from './postprocess';

export function getAdapter(cfg: LlmConfig, apiKey: string): LlmAdapter {
  return getAdapterForProvider(cfg.provider!, {
    apiKey,
    ollamaBaseUrl: cfg.ollamaBaseUrl,
    lmStudioBaseUrl: cfg.lmStudioBaseUrl,
  });
}

export interface AdapterProviderOpts {
  apiKey?: string;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
}

/**
 * Build an adapter from partial / pre-save parameters.
 * Used by routes that need to call listModels() or loadModel() before the
 * user has saved their config (e.g. the model-picker endpoint).
 */
export function getAdapterForProvider(
  provider: LlmProvider,
  opts: AdapterProviderOpts = {},
): LlmAdapter {
  const key = opts.apiKey ?? '';
  switch (provider) {
    case LlmProvider.Anthropic:
      return new AnthropicAdapter(key);

    case LlmProvider.OpenAI:
      return new OpenAICompatAdapter('https://api.openai.com', key);

    case LlmProvider.OpenRouter:
      return new OpenRouterAdapter('https://openrouter.ai/api', key);

    case LlmProvider.LmStudio:
      return new LmStudioAdapter(opts.lmStudioBaseUrl || DEFAULT_LMSTUDIO_URL, key);

    case LlmProvider.Ollama:
      return new OllamaAdapter(opts.ollamaBaseUrl || DEFAULT_OLLAMA_URL);

    default:
      throw new Error(`No adapter for provider: ${String(provider)}`);
  }
}
