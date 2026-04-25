import type { LlmCallPurpose } from '@shared/types';
import { GenerateJsonTruncatedError } from './generate-json-truncated-error';
import { finaliseLlmCall, insertLlmCall } from '../services/llm-call-log';
import type {
  LlmAdapter,
  AdapterStreamOptions,
  AdapterResult,
  AdapterGenerateOptions,
  AdapterCallOptions,
  CallResult,
  StructuredGenerateJsonResult,
} from './types';

function stripLlmLog<T extends { llmLog?: unknown }>(opts: T): Omit<T, 'llmLog'> {
  const { llmLog: _, ...rest } = opts;
  return rest as Omit<T, 'llmLog'>;
}

export function wrapLlmAdapterWithCallLogging(inner: LlmAdapter, provider: string): LlmAdapter {
  return {
    async stream(opts: AdapterStreamOptions): Promise<AdapterResult> {
      const lg = opts.llmLog ?? { chatId: null as string | null, purpose: 'chat' as LlmCallPurpose };
      const id = insertLlmCall({
        chatId: lg.chatId,
        purpose: lg.purpose,
        provider,
        model: opts.model,
        requestJson: JSON.stringify({
          model: opts.model,
          maxTokens: opts.maxTokens,
          messages: opts.messages,
          toolRound: lg.toolRound,
        }),
      });
      const started = Date.now();
      try {
        const result = await inner.stream(stripLlmLog(opts) as AdapterStreamOptions);
        finaliseLlmCall(id, {
          responseText: result.text || null,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          latencyMs: Date.now() - started,
          error: null,
        });
        return { ...result, llmCallId: id };
      } catch (err) {
        const aborted =
          err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('aborted'));
        const msg = aborted ? 'aborted' : err instanceof Error ? err.message : String(err);
        finaliseLlmCall(id, {
          responseText: null,
          promptTokens: null,
          completionTokens: null,
          latencyMs: Date.now() - started,
          error: msg,
        });
        throw err;
      }
    },

    generateJson: inner.generateJson
      ? async (opts: AdapterGenerateOptions): Promise<StructuredGenerateJsonResult> => {
          const lg = opts.llmLog ?? { chatId: null as string | null, purpose: 'abstract' as LlmCallPurpose };
          const id = insertLlmCall({
            chatId: lg.chatId,
            purpose: lg.purpose,
            provider,
            model: opts.model,
            requestJson: JSON.stringify({
              model: opts.model,
              maxTokens: opts.maxTokens,
              schemaName: opts.schemaName,
              messages: opts.messages,
            }),
          });
          const started = Date.now();
          try {
            const { content } = await inner.generateJson!(stripLlmLog(opts) as AdapterGenerateOptions);
            finaliseLlmCall(id, {
              responseText: content,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
            return { content, llmCallId: id };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const partial =
              err instanceof GenerateJsonTruncatedError ? err.partialContent : null;
            finaliseLlmCall(id, {
              responseText: partial ?? null,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    embed: inner.embed
      ? async (texts: string[], model: string, signal?: AbortSignal) => {
          const id = insertLlmCall({
            chatId: null,
            purpose: 'embedding',
            provider,
            model,
            requestJson: JSON.stringify({
              model,
              batchSize: texts.length,
              charLens: texts.map((t) => t.length),
            }),
          });
          const started = Date.now();
          const approxPromptTokens = Math.ceil(texts.reduce((a, t) => a + t.length, 0) / 4);
          try {
            const vectors = await inner.embed!(texts, model, signal);
            const dim = vectors[0]?.length ?? 0;
            finaliseLlmCall(id, {
              responseText: JSON.stringify({ count: vectors.length, dimensions: dim }),
              promptTokens: approxPromptTokens,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
            return vectors;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: approxPromptTokens,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    rerank: inner.rerank
      ? async (query: string, documents: string[], model: string, signal?: AbortSignal) => {
          const id = insertLlmCall({
            chatId: null,
            purpose: 'rerank',
            provider,
            model,
            requestJson: JSON.stringify({ query, documents }),
          });
          const started = Date.now();
          const approxPromptTokens = Math.round((query.length + documents.reduce((s, t) => s + t.length, 0)) / 4);
          try {
            const scores = await inner.rerank!(query, documents, model, signal);
            finaliseLlmCall(id, {
              responseText: JSON.stringify(scores),
              promptTokens: approxPromptTokens,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
            return scores;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: approxPromptTokens,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    listModels: inner.listModels
      ? async (signal?: AbortSignal) => {
          const id = insertLlmCall({
            chatId: null,
            purpose: 'list_models',
            provider,
            model: 'list_models',
            requestJson: JSON.stringify({ op: 'list_models' }),
          });
          const started = Date.now();
          try {
            const models = await inner.listModels!(signal);
            finaliseLlmCall(id, {
              responseText: JSON.stringify({ count: models.length, models }),
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
            return models;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    listEmbeddingModels: inner.listEmbeddingModels
      ? async (signal?: AbortSignal) => {
          const id = insertLlmCall({
            chatId: null,
            purpose: 'list_models',
            provider,
            model: 'list_embedding_models',
            requestJson: JSON.stringify({ op: 'list_embedding_models' }),
          });
          const started = Date.now();
          try {
            const models = await inner.listEmbeddingModels!(signal);
            finaliseLlmCall(id, {
              responseText: JSON.stringify({ count: models.length, models }),
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
            return models;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    listRerankerModels: inner.listRerankerModels
      ? async (signal?: AbortSignal) => {
          const id = insertLlmCall({
            chatId: null,
            purpose: 'list_models',
            provider,
            model: 'list_reranker_models',
            requestJson: JSON.stringify({ op: 'list_reranker_models' }),
          });
          const started = Date.now();
          try {
            const models = await inner.listRerankerModels!(signal);
            finaliseLlmCall(id, {
              responseText: JSON.stringify({ count: models.length, models }),
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
            return models;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    loadModel: inner.loadModel
      ? async (model: string, signal?: AbortSignal) => {
          const id = insertLlmCall({
            chatId: null,
            purpose: 'load_model',
            provider,
            model,
            requestJson: JSON.stringify({ model }),
          });
          const started = Date.now();
          try {
            await inner.loadModel!(model, signal);
            finaliseLlmCall(id, {
              responseText: '(ok)',
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: null,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,

    call: inner.call
      ? async (opts: AdapterCallOptions): Promise<CallResult> => {
          const lg = opts.llmLog ?? { chatId: null as string | null, purpose: 'chat' as LlmCallPurpose };
          const id = insertLlmCall({
            chatId: lg.chatId,
            purpose: lg.purpose,
            provider,
            model: opts.model,
            requestJson: JSON.stringify({
              model: opts.model,
              maxTokens: opts.maxTokens,
              toolRound: lg.toolRound,
              messages: opts.messages,
            }),
          });
          const started = Date.now();
          try {
            const result = await inner.call!(stripLlmLog(opts) as AdapterCallOptions);
            finaliseLlmCall(id, {
              responseText: result.text ?? null,
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
              latencyMs: Date.now() - started,
              error: null,
            });
            return { ...result, llmCallId: id };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            finaliseLlmCall(id, {
              responseText: null,
              promptTokens: null,
              completionTokens: null,
              latencyMs: Date.now() - started,
              error: msg,
            });
            throw err;
          }
        }
      : undefined,
  } as LlmAdapter;
}
