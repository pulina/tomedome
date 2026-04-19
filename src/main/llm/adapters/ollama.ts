import type { LlmAdapter, AdapterStreamOptions, AdapterResult, AdapterGenerateOptions } from '../types';
import { getLogger } from '../../lib/logger';
import { withUserAgent } from '../user-agent';
import { readStream, safeText } from '../wire';

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

  async generateJson(opts: AdapterGenerateOptions): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;
    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        messages: opts.messages,
        format: opts.schema,
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as { message: { content: string }; done_reason?: string };
    if (json.done_reason === 'length') {
      throw new Error(`generateJson truncated: model hit max_tokens (${opts.maxTokens}) — increase maxTokens or reduce input`);
    }
    return json.message.content;
  }

  async stream(opts: AdapterStreamOptions): Promise<AdapterResult> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;

    const res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers: withUserAgent({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: opts.model,
        stream: true,
        messages: opts.messages,
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
