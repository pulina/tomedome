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
import { wrapLlmAdapterWithCallLogging } from './logging-adapter';
import { AnthropicAdapter } from './adapters/anthropic';
import { OpenAICompatAdapter } from './adapters/openai-compat';
import { OpenRouterAdapter } from './adapters/openrouter';
import { LmStudioAdapter } from './adapters/lmstudio';
import { OllamaAdapter } from './adapters/ollama';

export type {
  LlmAdapter,
  AdapterStreamOptions,
  AdapterResult,
  Message,
  MessageRole,
  ToolDefinition,
  ToolCall,
  AgentMessage,
  AdapterCallOptions,
  CallResult,
  StructuredGenerateJsonResult,
  LlmAdapterCallContext,
} from './types';
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
  let inner: LlmAdapter;
  switch (provider) {
    case LlmProvider.Anthropic:
      inner = new AnthropicAdapter(key);
      break;

    case LlmProvider.OpenAI:
      inner = new OpenAICompatAdapter('https://api.openai.com', key);
      break;

    case LlmProvider.OpenRouter:
      inner = new OpenRouterAdapter('https://openrouter.ai/api', key);
      break;

    case LlmProvider.LmStudio:
      inner = new LmStudioAdapter(opts.lmStudioBaseUrl || DEFAULT_LMSTUDIO_URL, key);
      break;

    case LlmProvider.Ollama:
      inner = new OllamaAdapter(opts.ollamaBaseUrl || DEFAULT_OLLAMA_URL);
      break;

    default:
      throw new Error(`No adapter for provider: ${String(provider)}`);
  }
  return wrapLlmAdapterWithCallLogging(inner, String(provider));
}
