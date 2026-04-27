import { OpenAICompatAdapter } from './openai-compat';
import { withUserAgent } from '../user-agent';
import type { AdapterStreamOptions, AdapterResult } from '../types';

/**
 * LM Studio adapter — OpenAI-compatible chat + embeddings + model management.
 * Extends OpenAICompatAdapter with LM Studio-specific model loading.
 */
export class LmStudioAdapter extends OpenAICompatAdapter {
  // stream_options.include_usage support varies across LM Studio builds.
  // Call super.stream() and fill in character-based estimates for any null counts.
  override async stream(opts: AdapterStreamOptions): Promise<AdapterResult> {
    const result = await super.stream(opts);
    if (result.promptTokens !== null && result.completionTokens !== null) return result;
    const inputChars = opts.messages.reduce((sum, m) => sum + m.content.length, 0);
    return {
      ...result,
      promptTokens: result.promptTokens ?? Math.round(inputChars / 4),
      completionTokens: result.completionTokens ?? Math.round(result.text.length / 4),
    };
  }

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
