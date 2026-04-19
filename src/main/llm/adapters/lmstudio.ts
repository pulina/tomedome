import { OpenAICompatAdapter } from './openai-compat';
import { withUserAgent } from '../user-agent';

/**
 * LM Studio adapter — OpenAI-compatible chat + embeddings + model management.
 * Extends OpenAICompatAdapter with LM Studio-specific model loading.
 */
export class LmStudioAdapter extends OpenAICompatAdapter {
  async loadModel(model: string, signal?: AbortSignal): Promise<void> {
    // LM Studio 0.3+ proprietary endpoint to load a model into memory.
    // Silently ignore errors — older versions or different builds may not support it.
    try {
      const url = `${this.baseUrl.replace(/\/$/, '')}/v1/models/load`;
      await fetch(url, {
        method: 'POST',
        signal,
        headers: withUserAgent({ 'content-type': 'application/json' }),
        body: JSON.stringify({ identifier: model }),
      });
    } catch {
      // not supported — will load automatically when first used
    }
  }
}
