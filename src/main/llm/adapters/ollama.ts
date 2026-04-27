import { randomUUID } from 'crypto';
import type {
  LlmAdapter,
  AdapterStreamOptions,
  AdapterResult,
  AdapterGenerateOptions,
  AdapterCallOptions,
  CallResult,
  StructuredGenerateJsonResult,
} from '../types';
import { GenerateJsonTruncatedError } from '../generate-json-truncated-error';
import { getLogger } from '../../lib/logger';
import { withUserAgent } from '../user-agent';
import { readStream, safeText } from '../wire';
import { stripThinkBlocks } from '../postprocess';

export class OllamaAdapter implements LlmAdapter {
  constructor(private readonly baseUrl: string) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/tags`;
    try {
      const res = await fetch(url, { signal, headers: withUserAgent({}) });
      if (!res.ok) {
        getLogger().warn(
          { status: res.status, body: await safeText(res) },
          'Ollama listModels failed',
        );
        return [];
      }
      const json = await res.json() as { models: Array<{ name: string }> };
      return (json.models ?? []).map((m) => m.name).sort();
    } catch (err) {
      getLogger().warn({ err }, 'Ollama listModels failed');
      return [];
    }
  }

  async loadModel(model: string, signal?: AbortSignal): Promise<void> {
    // Empty prompt with keep_alive loads the model into memory without generating.
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/generate`;
    await fetch(url, {
      method: 'POST',
      signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model, prompt: '', keep_alive: '10m' }),
    });
  }

  async embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/embed`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as { embeddings: number[][] };
    return json.embeddings;
  }

  async rerank(
    query: string,
    documents: string[],
    model: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/rerank`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model, query, documents }),
    });
    if (!res.ok) throw new Error(`Ollama rerank HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as { results: Array<{ index: number; relevance_score: number }> };
    // Map back to original document order
    const scores = new Array<number>(documents.length).fill(0);
    for (const r of json.results) scores[r.index] = r.relevance_score;
    return scores;
  }

  async generateJson(opts: AdapterGenerateOptions): Promise<StructuredGenerateJsonResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;
    const ollamaOpts: Record<string, number> = {};
    if (opts.temperature !== undefined) ollamaOpts.temperature = opts.temperature;
    if (opts.topP !== undefined) ollamaOpts.top_p = opts.topP;
    if (opts.topK !== undefined) ollamaOpts.top_k = opts.topK;
    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: opts.messages,
        format: opts.schema,
        ...(Object.keys(ollamaOpts).length > 0 ? { options: ollamaOpts } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as {
      message?: { content?: string | null };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (json.done_reason === 'length') {
      const partial = json.message?.content ?? null;
      throw new GenerateJsonTruncatedError(opts.maxTokens, partial);
    }
    const c = json.message?.content;
    if (c == null) throw new Error('No content in generateJson response');
    return {
      content: c,
      promptTokens: json.prompt_eval_count ?? null,
      completionTokens: json.eval_count ?? null,
    };
  }

  async call(opts: AdapterCallOptions): Promise<CallResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;
    const ollamaOpts: Record<string, number> = {};
    if (opts.temperature !== undefined) ollamaOpts.temperature = opts.temperature;
    if (opts.topP !== undefined) ollamaOpts.top_p = opts.topP;
    if (opts.topK !== undefined) ollamaOpts.top_k = opts.topK;

    // Convert AgentMessage[] to Ollama wire format.
    // Differences from OpenAI: tool results have no tool_call_id; assistant tool_call
    // arguments are objects (not JSON strings); no id field on tool calls.
    const ollamaMessages: Array<Record<string, unknown>> = [];
    for (const m of opts.messages) {
      if (m.role === 'tool_result') {
        ollamaMessages.push({ role: 'tool', content: m.content });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        ollamaMessages.push({
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else {
        // At this point role is 'system' | 'user' | plain 'assistant' — all carry content: string.
        ollamaMessages.push({ role: m.role, content: (m as { role: string; content: string }).content });
      }
    }

    const tools = opts.tools?.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: ollamaMessages,
        ...(tools?.length ? { tools } : {}),
        ...(Object.keys(ollamaOpts).length > 0 ? { options: ollamaOpts } : {}),
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await safeText(res)}`);

    const json = await res.json() as {
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          function: { name: string; arguments: Record<string, unknown> };
        }>;
      };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    // Strip think blocks from content — Qwen3 and similar models embed reasoning
    // tokens in message.content even in non-streaming tool-call responses.
    const rawText = json.message?.content ?? null;
    const text = rawText ? (stripThinkBlocks(rawText) || null) : null;

    // Ollama does not provide tool call IDs; generate UUIDs so the agentic loop
    // can track them in the message history (Ollama ignores IDs in subsequent
    // tool_result messages, but our AgentMessage type requires them).
    const toolCalls = (json.message?.tool_calls ?? []).map((tc) => ({
      id: randomUUID(),
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      text,
      toolCalls,
      promptTokens: json.prompt_eval_count ?? null,
      completionTokens: json.eval_count ?? null,
    };
  }

  async stream(opts: AdapterStreamOptions): Promise<AdapterResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;
    const ollamaOpts: Record<string, number> = {};
    if (opts.temperature !== undefined) ollamaOpts.temperature = opts.temperature;
    if (opts.topP !== undefined) ollamaOpts.top_p = opts.topP;
    if (opts.topK !== undefined) ollamaOpts.top_k = opts.topK;

    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        messages: opts.messages,
        ...(Object.keys(ollamaOpts).length > 0 ? { options: ollamaOpts } : {}),
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama HTTP ${res.status}: ${await safeText(res)}`);
    }

    let text = '';
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    let tail = '';

    await readStream(res.body, (chunk) => {
      tail += chunk;
      let nl: number;
      while ((nl = tail.indexOf('\n')) !== -1) {
        const line = tail.slice(0, nl).trim();
        tail = tail.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const delta = obj.message?.content;
          if (typeof delta === 'string') {
            text += delta;
            opts.onToken?.(delta);
          }
          if (obj.done) {
            if (obj.prompt_eval_count != null) promptTokens = obj.prompt_eval_count;
            if (obj.eval_count != null) completionTokens = obj.eval_count;
          }
        } catch {
          // ignore malformed lines
        }
      }
    }, opts.signal);

    return { text, promptTokens, completionTokens };
  }
}
