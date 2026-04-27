import type {
  LlmAdapter,
  AdapterStreamOptions,
  AdapterResult,
  AdapterGenerateOptions,
  StructuredGenerateJsonResult,
} from '../types';
import { GenerateJsonTruncatedError } from '../generate-json-truncated-error';
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
