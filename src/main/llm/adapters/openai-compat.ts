/**
 * Adapter for any OpenAI-compatible chat completions endpoint.
 * Covers: OpenAI, OpenRouter, LM Studio — same wire format, different URL + auth.
 */
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
import { readStream, safeText, SseParser } from '../wire';

export class OpenAICompatAdapter implements LlmAdapter {
  constructor(
    protected readonly baseUrl: string,
    /** Bearer token. Pass empty string to omit the Authorization header. */
    protected readonly apiKey: string,
  ) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/models`;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    try {
      const res = await fetch(url, { signal, headers: withUserAgent(headers) });
      if (!res.ok) {
        getLogger().warn(
          { status: res.status, body: await safeText(res) },
          'OpenAI-compatible listModels failed',
        );
        return [];
      }
      const json = await res.json() as { data: Array<{ id: string }> };
      return (json.data ?? []).map((m) => m.id).sort();
    } catch (err) {
      getLogger().warn({ err }, 'OpenAI-compatible listModels failed');
      return [];
    }
  }

  async embed(texts: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/embeddings`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: withUserAgent(headers),
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }

  async generateJson(opts: AdapterGenerateOptions): Promise<StructuredGenerateJsonResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent(headers),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        max_tokens: opts.maxTokens,
        messages: opts.messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
        },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as {
      choices: Array<{ message: { content?: string | null }; finish_reason?: string }>;
    };
    const choice = json.choices[0];
    if (choice?.finish_reason === 'length') {
      const partial = choice?.message?.content ?? null;
      throw new GenerateJsonTruncatedError(opts.maxTokens, partial);
    }
    const content = choice?.message?.content;
    if (content == null) throw new Error('No content in generateJson response');
    return { content };
  }

  async call(opts: AdapterCallOptions): Promise<CallResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;

    // Convert AgentMessage[] to OpenAI wire format
    const openaiMessages: Array<Record<string, unknown>> = [];
    for (const m of opts.messages) {
      if (m.role === 'tool_result') {
        openaiMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        openaiMessages.push({
          role: 'assistant',
          content: m.content ?? null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        openaiMessages.push({ role: m.role, content: (m as { role: string; content: string }).content });
      }
    }

    const tools = opts.tools?.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent(headers),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        max_tokens: opts.maxTokens,
        messages: openaiMessages,
        ...(tools?.length ? { tools } : {}),
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);

    const json = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = json.choices[0];
    const text = choice?.message?.content ?? null;
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => {
        try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { return {}; }
      })(),
    }));

    return {
      text,
      toolCalls,
      promptTokens: json.usage?.prompt_tokens ?? null,
      completionTokens: json.usage?.completion_tokens ?? null,
    };
  }

  async stream(opts: AdapterStreamOptions): Promise<AdapterResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent(headers),
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        max_tokens: opts.maxTokens,
        messages: opts.messages,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);
    }

    let text = '';
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    const parser = new SseParser();

    await readStream(res.body, (chunk) => {
      parser.push(chunk, ({ data }) => {
        if (!data || data === '[DONE]') return;
        try {
          const obj = JSON.parse(data);
          const delta = obj.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') {
            text += delta;
            opts.onToken?.(delta);
          }
          if (obj.usage) {
            promptTokens = obj.usage.prompt_tokens ?? promptTokens;
            completionTokens = obj.usage.completion_tokens ?? completionTokens;
          }
        } catch {
          // ignore malformed SSE frames
        }
      });
    }, opts.signal);

    return { text, promptTokens, completionTokens };
  }
}
