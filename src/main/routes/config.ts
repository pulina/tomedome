import { FastifyInstance } from 'fastify';
import { apiErr } from '../lib/api-errors';
import {
  getAbstractConfig,
  getApiKeyForProvider,
  getApiKeyPlaintext,
  getLlmConfig,
  getRerankerConfig,
  isLlmConfigured,
  saveAbstractConfig,
  saveLlmConfig,
  saveRerankerConfig,
} from '../services/config-service';
import { probeLocalLlmBaseUrl, testLlmConnection } from '../services/llm-test';
import { getAdapterForProvider } from '../llm';
import { AbstractConfig, DEFAULT_ABSTRACT_DETAIL_LEVEL, LlmProvider, PROVIDER_MODELS, RerankerConfig } from '@shared/types';
import { schemas } from './schemas';

interface SaveBody {
  provider: LlmProvider;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
}

interface ModelsBody {
  provider: LlmProvider;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
  modelType?: 'chat' | 'embedding' | 'reranker';
}

interface LoadModelBody {
  provider: LlmProvider;
  model: string;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
}

export async function registerConfigRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/config/abstract', async () => getAbstractConfig());

  fastify.put<{ Body: AbstractConfig }>(
    '/api/config/abstract',
    { schema: { body: schemas.configAbstractBody } },
    async (req, reply) => {
      const { maxTokensDetailed, maxTokensShort, maxTokensBook, detailLevel } = req.body ?? {};
      if (
        typeof maxTokensDetailed !== 'number' ||
        typeof maxTokensShort !== 'number' ||
        typeof maxTokensBook !== 'number'
      ) {
        return reply
          .code(400)
          .send(apiErr('validation', 'maxTokensDetailed, maxTokensShort, maxTokensBook must be numbers'));
      }
      saveAbstractConfig({
        maxTokensDetailed,
        maxTokensShort,
        maxTokensBook,
        detailLevel: typeof detailLevel === 'number' ? detailLevel : DEFAULT_ABSTRACT_DETAIL_LEVEL,
      });
      return getAbstractConfig();
    },
  );

  fastify.get('/api/config/llm', async () => getLlmConfig());

  fastify.get('/api/config/llm/status', async () => ({ configured: isLlmConfigured() }));

  fastify.put<{ Body: SaveBody }>(
    '/api/config/llm',
    { schema: { body: schemas.configLlmSaveBody } },
    async (req, reply) => {
      const body = req.body;
      saveLlmConfig({
        provider: body.provider,
        model: body.model,
        embeddingModel: typeof body.embeddingModel === 'string' ? body.embeddingModel : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        ollamaBaseUrl: typeof body.ollamaBaseUrl === 'string' ? body.ollamaBaseUrl : undefined,
        lmStudioBaseUrl: typeof body.lmStudioBaseUrl === 'string' ? body.lmStudioBaseUrl : undefined,
      });
      return getLlmConfig();
    },
  );

  fastify.get('/api/config/reranker', async () => getRerankerConfig());

  fastify.put<{ Body: RerankerConfig }>(
    '/api/config/reranker',
    { schema: { body: schemas.configRerankerBody } },
    async (req, reply) => {
      const { model, enabled, topKMultiplier } = req.body;
      saveRerankerConfig({ model, enabled: Boolean(enabled), topKMultiplier });
      return getRerankerConfig();
    },
  );

  fastify.post('/api/config/llm/test', async () => {
    return await testLlmConnection(getLlmConfig(), getApiKeyPlaintext());
  });

  fastify.post<{ Body: { kind: 'ollama' | 'lmstudio'; url: string } }>(
    '/api/config/llm/base-url-health',
    { schema: { body: schemas.configBaseUrlHealthBody } },
    async (req) => probeLocalLlmBaseUrl(req.body.kind, req.body.url),
  );

  /**
   * Returns the model list for a provider.
   * For Ollama and LM Studio: fetches dynamically via their local APIs.
   * For OpenAI / OpenRouter: fetches from their /v1/models endpoint.
   * For Anthropic: returns a static list.
   *
   * The caller passes the current form-state URLs (which may not be saved yet),
   * so this works before the user clicks Save.
   */
  fastify.post<{ Body: ModelsBody }>(
    '/api/config/llm/models',
    { schema: { body: schemas.configModelsBody } },
    async (req, reply) => {
      const { provider, ollamaBaseUrl, lmStudioBaseUrl, modelType = 'chat' } = req.body;

      if (provider === LlmProvider.Anthropic) {
        return { models: PROVIDER_MODELS[LlmProvider.Anthropic], dynamic: false };
      }

      const stored = getLlmConfig();
      const adapter = getAdapterForProvider(provider, {
        apiKey: getApiKeyForProvider(provider),
        ollamaBaseUrl: ollamaBaseUrl || stored.ollamaBaseUrl,
        lmStudioBaseUrl: lmStudioBaseUrl || stored.lmStudioBaseUrl,
      });

      try {
        if (modelType === 'embedding' && adapter.listEmbeddingModels) {
          return { models: await adapter.listEmbeddingModels(), dynamic: true };
        }
        if (modelType === 'reranker' && adapter.listRerankerModels) {
          return { models: await adapter.listRerankerModels(), dynamic: true };
        }
        if (!adapter.listModels) {
          return { models: PROVIDER_MODELS[provider] ?? [], dynamic: false };
        }
        return { models: await adapter.listModels(), dynamic: true };
      } catch (err) {
        return reply
          .code(502)
          .send(apiErr('upstream', err instanceof Error ? err.message : 'Failed to list models'));
      }
    },
  );

  /**
   * Trigger model loading for providers that require it (Ollama, LM Studio).
   * Fire-and-forget from the client's perspective — errors are swallowed.
   */
  fastify.post<{ Body: LoadModelBody }>(
    '/api/config/llm/load-model',
    { schema: { body: schemas.configLoadModelBody } },
    async (req, reply) => {
      const { provider, model, ollamaBaseUrl, lmStudioBaseUrl } = req.body;

      const stored = getLlmConfig();
      const adapter = getAdapterForProvider(provider, {
        ollamaBaseUrl: ollamaBaseUrl || stored.ollamaBaseUrl,
        lmStudioBaseUrl: lmStudioBaseUrl || stored.lmStudioBaseUrl,
      });

      if (adapter.loadModel) {
        try {
          await adapter.loadModel(model);
        } catch {
          // best-effort — not a hard failure
        }
      }

      return reply.code(204).send();
    },
  );
}
