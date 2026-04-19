import type { LlmAdapter, AdapterStreamOptions, AdapterResult, AdapterCallOptions, CallResult, AgentMessage } from '../types';
import { withUserAgent } from '../user-agent';
import { readStream, safeText, SseParser } from '../wire';

export class AnthropicAdapter implements LlmAdapter {
  constructor(private readonly apiKey: string) {}

  async stream(opts: AdapterStreamOptions): Promise<AdapterResult> {
    const system = opts.messages.find((m) => m.role === 'system')?.content;
    const nonSystem = opts.messages.filter((m) => m.role !== 'system');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      }),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        stream: true,
        ...(system ? { system } : {}),
        messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Anthropic HTTP ${res.status}: ${await safeText(res)}`);
    }

    let text = '';
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    const parser = new SseParser();

    await readStream(res.body, (chunk) => {
      parser.push(chunk, ({ event, data }) => {
        if (!data || data === '[DONE]') return;
        try {
          const obj = JSON.parse(data);
          if (event === 'content_block_delta' && obj.delta?.type === 'text_delta') {
            const delta = obj.delta.text as string;
            text += delta;
            opts.onToken?.(delta);
          } else if (event === 'message_delta' && obj.usage?.output_tokens != null) {
            completionTokens = obj.usage.output_tokens;
          } else if (event === 'message_start' && obj.message?.usage) {
            promptTokens = obj.message.usage.input_tokens ?? null;
          }
        } catch {
          // ignore malformed SSE frames
        }
      });
    }, opts.signal);

    return { text, promptTokens, completionTokens };
  }

  async call(opts: AdapterCallOptions): Promise<CallResult> {
    const system = opts.messages.find((m) => m.role === 'system')
      ? (opts.messages.find((m) => m.role === 'system') as { role: 'system'; content: string }).content
      : undefined;

    const nonSystem = opts.messages.filter((m) => m.role !== 'system');

    // Convert AgentMessage[] to Anthropic wire format
    const anthropicMessages = nonSystem.map((m) => {
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.toolCalls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            })),
          ],
        };
      }
      if (m.role === 'tool_result') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
        };
      }
      return { role: m.role, content: (m as { role: string; content: string }).content };
    });

    const tools = opts.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      }),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
        ...(tools?.length ? { tools } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic HTTP ${res.status}: ${await safeText(res)}`);
    }

    const json = (await res.json()) as {
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const text = json.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('') || null;

    const toolCalls = json.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id!, name: b.name!, arguments: b.input ?? {} }));

    return {
      text,
      toolCalls,
      promptTokens: json.usage?.input_tokens ?? null,
      completionTokens: json.usage?.output_tokens ?? null,
    };
  }
}
