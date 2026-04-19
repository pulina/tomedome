import { getLogger } from '../lib/logger';
import { getApiKeyPlaintext, getLlmConfig } from './config-service';
import { finaliseLlmCall, insertLlmCall } from './llm-call-log';
import { getAdapter, ThinkFilter, stripThinkBlocks } from '../llm';
import type { LlmCallPurpose } from '@shared/types';
import type { AgentMessage, ToolDefinition, ToolCall } from '../llm/types';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface StreamOptions {
  messages: ChatTurn[];
  chatId: string | null;
  purpose: LlmCallPurpose;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  onToken?: (chunk: string) => void;
}

export interface StreamResult {
  llmCallId: string;
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
  error: string | null;
}

export interface GenerateOptions {
  messages: ChatTurn[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  purpose?: LlmCallPurpose;
}

export type { AgentMessage, ToolDefinition, ToolCall };

/**
 * Non-streaming structured generation. Returns a parsed object of type T.
 * Uses adapter.generateJson() when the provider supports it (OpenAI-compat, Ollama).
 * Falls back to streamChat() + JSON extraction for providers without native support (Anthropic).
 */
export async function generateStructured<T>(opts: GenerateOptions): Promise<T> {
  const cfg = getLlmConfig();
  if (!cfg.provider) throw new Error('LLM not configured');
  const adapter = getAdapter(cfg, getApiKeyPlaintext());
  const log = getLogger().child({ module: 'llm-client', schemaName: opts.schemaName });

  const purpose = opts.purpose ?? 'abstract';
  const maxTokens = opts.maxTokens ?? 2048;

  if (adapter.generateJson) {
    const llmCallId = insertLlmCall({
      chatId: null,
      purpose,
      provider: cfg.provider,
      model: cfg.model,
      requestJson: JSON.stringify({ model: cfg.model, schemaName: opts.schemaName, messages: opts.messages }),
    });
    const started = Date.now();
    let raw: string | undefined;
    let errorMsg: string | null = null;

    try {
      raw = await adapter.generateJson({
        messages: opts.messages,
        model: cfg.model,
        maxTokens,
        schemaName: opts.schemaName,
        schema: opts.schema,
        signal: opts.abortSignal,
      });
      log.debug({ rawLength: raw.length }, 'generateJson raw response');
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'generateJson failed');
      finaliseLlmCall(llmCallId, { responseText: null, promptTokens: null, completionTokens: null, latencyMs: Date.now() - started, error: errorMsg });
      throw err;
    }

    try {
      const parsed = JSON.parse(raw) as T;
      finaliseLlmCall(llmCallId, { responseText: raw, promptTokens: null, completionTokens: null, latencyMs: Date.now() - started, error: null });
      return parsed;
    } catch (err) {
      errorMsg = `JSON parse failed: ${(err as Error).message}`;
      log.error({ raw: raw.slice(0, 500), err }, 'generateJson JSON parse failed');
      finaliseLlmCall(llmCallId, { responseText: raw, promptTokens: null, completionTokens: null, latencyMs: Date.now() - started, error: errorMsg });
      throw new Error(`Failed to parse structured response: ${(err as Error).message}. Raw (first 500 chars): ${raw.slice(0, 500)}`);
    }
  }

  // Fallback: stream and extract JSON from the response text (streamChat logs its own call)
  const result = await streamChat({
    messages: opts.messages,
    chatId: null,
    purpose,
    maxTokens,
    abortSignal: opts.abortSignal,
  });
  if (result.error) throw new Error(result.error);
  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) {
    log.error({ text: result.text.slice(0, 500) }, 'generateStructured fallback: no JSON in response');
    throw new Error('No JSON object found in model response');
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch (err) {
    log.error({ raw: match[0].slice(0, 500), err }, 'generateStructured fallback JSON parse failed');
    throw new Error(`Failed to parse structured response (fallback): ${(err as Error).message}`);
  }
}

/**
 * Runs a streaming LLM completion against the currently-configured provider.
 * Handles logging, think-block filtering, and error normalisation.
 * The caller only sees clean text — provider differences are inside the adapter.
 */
export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const cfg = getLlmConfig();
  if (!cfg.provider) throw new Error('LLM not configured');

  const model = cfg.model;
  const provider = cfg.provider;
  const adapter = getAdapter(cfg, getApiKeyPlaintext());

  const llmCallId = insertLlmCall({
    chatId: opts.chatId,
    purpose: opts.purpose,
    provider,
    model,
    requestJson: JSON.stringify({ model, messages: opts.messages }),
  });
  const started = Date.now();
  const log = getLogger().child({ module: 'llm-client', provider, llmCallId });

  // Wrap onToken with a think-block filter so <think>…</think> reasoning
  // sections are stripped from the live token stream sent to the frontend.
  const thinkFilter = opts.onToken ? new ThinkFilter(opts.onToken) : null;
  const onToken = thinkFilter ? (chunk: string) => thinkFilter.push(chunk) : undefined;

  let text = '';
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let errorMsg: string | null = null;

  try {
    ({ text, promptTokens, completionTokens } = await adapter.stream({
      messages: opts.messages,
      model,
      maxTokens: opts.maxTokens ?? 2048,
      onToken,
      signal: opts.abortSignal,
    }));
    thinkFilter?.flush();
    // Strip any think blocks the streaming filter may have missed
    // (e.g. stream ended before </think>, or tag straddled a chunk boundary edge case).
    text = stripThinkBlocks(text);
  } catch (err) {
    const aborted =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
    errorMsg = aborted ? 'aborted' : err instanceof Error ? err.message : String(err);
    if (!aborted) log.warn({ errorMsg }, 'llm stream ended with error');
  }

  finaliseLlmCall(llmCallId, {
    responseText: text || null,
    promptTokens,
    completionTokens,
    latencyMs: Date.now() - started,
    error: errorMsg,
  });

  return { llmCallId, text, promptTokens, completionTokens, error: errorMsg };
}

/**
 * Run an agentic tool-resolution loop (non-streaming).
 *
 * If the adapter supports tool calling (call() method), runs up to maxRounds
 * of tool-call resolution, executing each requested tool via the executor
 * callback. Returns the final assistant text and the full resolved message
 * history (including tool turns).
 *
 * If the adapter does not support call(), returns null so the caller can
 * fall back to regular streamChat().
 */
export async function resolveToolCalls(opts: {
  messages: AgentMessage[];
  tools: ToolDefinition[];
  executor: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Called just before each tool is executed. Use to emit progress events. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  maxRounds?: number;
  abortSignal?: AbortSignal;
  chatId?: string | null;
}): Promise<{ text: string; messages: AgentMessage[]; llmCallId: string | null; promptTokens: number | null } | null> {
  const cfg = getLlmConfig();
  if (!cfg.provider) return null;
  const adapter = getAdapter(cfg, getApiKeyPlaintext());
  if (!adapter.call) return null;

  const { tools, executor, onToolCall, maxRounds = 5, abortSignal } = opts;
  const messages: AgentMessage[] = [...opts.messages];
  const log = getLogger().child({ module: 'llm-client', fn: 'resolveToolCalls' });
  let lastLlmCallId: string | null = null;
  let lastPromptTokens: number | null = null;

  for (let round = 0; round < maxRounds; round++) {
    if (abortSignal?.aborted) return null;

    const llmCallId = insertLlmCall({
      chatId: opts.chatId ?? null,
      purpose: 'chat',
      provider: cfg.provider,
      model: cfg.model,
      requestJson: JSON.stringify({ model: cfg.model, round, messages }),
    });
    const started = Date.now();

    let result: Awaited<ReturnType<NonNullable<typeof adapter.call>>>;
    try {
      result = await adapter.call({
        messages,
        model: cfg.model,
        maxTokens: 2048,
        tools,
        signal: abortSignal,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      finaliseLlmCall(llmCallId, { responseText: null, promptTokens: null, completionTokens: null, latencyMs: Date.now() - started, error: errorMsg });
      throw err;
    }

    finaliseLlmCall(llmCallId, {
      responseText: result.text ?? null,
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      latencyMs: Date.now() - started,
      error: null,
    });
    lastLlmCallId = llmCallId;
    lastPromptTokens = result.promptTokens ?? null;

    if (result.toolCalls.length === 0) {
      // No tool calls — final answer in result.text
      messages.push({ role: 'assistant', content: result.text ?? '', toolCalls: [] });
      return { text: result.text ?? '', messages, llmCallId, promptTokens: lastPromptTokens };
    }

    log.debug({ round, tools: result.toolCalls.map((t: ToolCall) => t.name) }, 'tool calls requested');

    // Add the assistant message with tool calls to history
    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

    // Execute each tool call
    for (const tc of result.toolCalls) {
      if (abortSignal?.aborted) return null;
      onToolCall?.(tc.name, tc.arguments);
      let output: string;
      try {
        output = await executor(tc.name, tc.arguments);
      } catch (err) {
        output = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({ role: 'tool_result', toolCallId: tc.id, name: tc.name, content: output });
    }
  }

  // Exceeded max rounds — return what we have (last assistant text if any)
  const lastAssistant = [...messages].reverse().find((m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant');
  return { text: lastAssistant?.content ?? '', messages, llmCallId: lastLlmCallId, promptTokens: lastPromptTokens };
}
