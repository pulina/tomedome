import { getLogger } from '../lib/logger';
import { getApiKeyPlaintext, getLlmConfig } from './config-service';
import { patchLlmCallError } from './llm-call-log';
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
    let llmCallId: string | undefined;
    let raw: string | undefined;
    try {
      const gen = await adapter.generateJson({
        messages: opts.messages,
        model: cfg.model,
        maxTokens,
        schemaName: opts.schemaName,
        schema: opts.schema,
        signal: opts.abortSignal,
        llmLog: { chatId: null, purpose },
      });
      raw = gen.content;
      llmCallId = gen.llmCallId;
      log.debug({ rawLength: raw.length }, 'generateJson raw response');
    } catch (err) {
      log.error({ err }, 'generateJson failed');
      throw err;
    }

    try {
      return JSON.parse(raw!) as T;
    } catch (err) {
      const errorMsg = `JSON parse failed: ${(err as Error).message}`;
      log.error({ raw: raw!.slice(0, 500), err }, 'generateJson JSON parse failed');
      if (llmCallId) patchLlmCallError(llmCallId, errorMsg);
      throw new Error(
        `Failed to parse structured response: ${(err as Error).message}. Raw (first 500 chars): ${raw!.slice(0, 500)}`,
      );
    }
  }

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
 * Handles think-block filtering, error normalisation, and provider call logging (adapter wrapper).
 */
export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const cfg = getLlmConfig();
  if (!cfg.provider) throw new Error('LLM not configured');

  const model = cfg.model;
  const adapter = getAdapter(cfg, getApiKeyPlaintext());

  const thinkFilter = opts.onToken ? new ThinkFilter(opts.onToken) : null;
  const onToken = thinkFilter ? (chunk: string) => thinkFilter.push(chunk) : undefined;

  const r = await adapter.stream({
    messages: opts.messages,
    model,
    maxTokens: opts.maxTokens ?? 2048,
    onToken,
    signal: opts.abortSignal,
    llmLog: { chatId: opts.chatId, purpose: opts.purpose },
  });

  thinkFilter?.flush();

  const llmCallId = r.llmCallId;
  if (!llmCallId) throw new Error('stream missing llmCallId (logging adapter not applied?)');

  const errorMsg: string | null = null;
  const text = stripThinkBlocks(r.text);
  const promptTokens = r.promptTokens;
  const completionTokens = r.completionTokens;

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

    const result = await adapter.call({
      messages,
      model: cfg.model,
      maxTokens: 2048,
      tools,
      signal: abortSignal,
      llmLog: { chatId: opts.chatId ?? null, purpose: 'chat', toolRound: round },
    });

    lastLlmCallId = result.llmCallId ?? lastLlmCallId;
    lastPromptTokens = result.promptTokens ?? null;

    if (result.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: result.text ?? '', toolCalls: [] });
      return { text: result.text ?? '', messages, llmCallId: lastLlmCallId, promptTokens: lastPromptTokens };
    }

    log.debug({ round, tools: result.toolCalls.map((t: ToolCall) => t.name) }, 'tool calls requested');

    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

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

  const lastAssistant = [...messages].reverse().find((m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant');
  return { text: lastAssistant?.content ?? '', messages, llmCallId: lastLlmCallId, promptTokens: lastPromptTokens };
}
