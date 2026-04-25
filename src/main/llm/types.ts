import type { LlmCallPurpose } from '@shared/types';

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
}

/** Optional metadata for `insertLlmCall` when the adapter is wrapped with request logging. */
export interface LlmAdapterCallContext {
  chatId: string | null;
  purpose: LlmCallPurpose;
  /** Tool-calling loop round when `purpose` is `chat`. */
  toolRound?: number;
}

export interface AdapterStreamOptions {
  messages: Message[];
  model: string;
  maxTokens: number;
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
  llmLog?: LlmAdapterCallContext;
}

export interface AdapterResult {
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Set by the logging adapter after a logged provider stream. */
  llmCallId?: string;
}

export interface AdapterGenerateOptions {
  messages: Message[];
  model: string;
  maxTokens: number;
  /** Name for the JSON schema (shown to model). */
  schemaName: string;
  /** JSON Schema object that constrains the response shape. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
  llmLog?: LlmAdapterCallContext;
}

/** Structured JSON generation result; `llmCallId` is set when using the logging-wrapped adapter. */
export interface StructuredGenerateJsonResult {
  content: string;
  llmCallId?: string;
}

// ── Tool-calling types ────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Extended message type used in the agentic tool-call loop. */
export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool_result'; toolCallId: string; name: string; content: string };

export interface AdapterCallOptions {
  messages: AgentMessage[];
  model: string;
  maxTokens: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  llmLog?: LlmAdapterCallContext;
}

export interface CallResult {
  /** Final text response, or null if the turn ended in tool calls. */
  text: string | null;
  toolCalls: ToolCall[];
  promptTokens: number | null;
  completionTokens: number | null;
  llmCallId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface LlmAdapter {
  stream(opts: AdapterStreamOptions): Promise<AdapterResult>;
  /**
   * Non-streaming structured generation. Sends a JSON Schema constraint to the
   * provider and returns the raw JSON string. Optional — providers that don't
   * support it are handled by the fallback path in generateStructured().
   */
  generateJson?(opts: AdapterGenerateOptions): Promise<StructuredGenerateJsonResult>;
  /** Batch-embed texts. Throws if this provider does not support embeddings. */
  embed?(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]>;
  /**
   * Rerank documents against a query. Returns relevance scores in the same
   * order as the input documents array (not sorted). Only available on
   * providers with a dedicated rerank endpoint (Ollama, OpenRouter).
   */
  rerank?(query: string, documents: string[], model: string, signal?: AbortSignal): Promise<number[]>;
  /** List available chat/completion models. Returns undefined if provider has no list API. */
  listModels?(signal?: AbortSignal): Promise<string[]>;
  /** List available embedding models. Falls back to listModels if not implemented. */
  listEmbeddingModels?(signal?: AbortSignal): Promise<string[]>;
  /** List available reranker models. Falls back to listModels if not implemented. */
  listRerankerModels?(signal?: AbortSignal): Promise<string[]>;
  /** Load / warm-up a model before use. No-op if not supported. */
  loadModel?(model: string, signal?: AbortSignal): Promise<void>;
  /**
   * Non-streaming call with optional tool use. Returns tool calls (if model
   * requested them) or final text. Optional — providers without tool support
   * fall back to context-injection in the chat route.
   */
  call?(opts: AdapterCallOptions): Promise<CallResult>;
}
