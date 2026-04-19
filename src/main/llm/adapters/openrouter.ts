import { OpenAICompatAdapter } from './openai-compat';
import { withUserAgent } from '../user-agent';
import { safeText } from '../wire';

const RERANKER_MODELS = [
  'cohere/rerank-4-pro',
  'cohere/rerank-4-fast',
  'cohere/rerank-v3-5',
];

/**
 * OpenRouter adapter — extends OpenAI-compat with the dedicated rerank endpoint.
 * POST https://openrouter.ai/api/v1/rerank
 */
export class OpenRouterAdapter extends OpenAICompatAdapter {
  async listEmbeddingModels(signal?: AbortSignal): Promise<string[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/embeddings/models`;
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, { signal, headers: withUserAgent(headers) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as { data: Array<{ id: string }> };
    return json.data.map((m) => m.id).sort();
  }

  async listRerankerModels(): Promise<string[]> {
    return RERANKER_MODELS;
  }

  async rerank(
    query: string,
    documents: string[],
    model: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/v1/rerank`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: withUserAgent(headers),
      body: JSON.stringify({ model, query, documents }),
    });
    if (!res.ok) throw new Error(`OpenRouter rerank HTTP ${res.status}: ${await safeText(res)}`);
    const json = await res.json() as { results: Array<{ index: number; relevance_score: number }> };
    const scores = new Array<number>(documents.length).fill(0);
    for (const r of json.results) scores[r.index] = r.relevance_score;
    return scores;
  }
}
