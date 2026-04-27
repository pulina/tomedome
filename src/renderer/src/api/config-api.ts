import { api } from './client';
import type { AbstractConfig, LlmConfig, LlmProvider, LlmStatus, RerankerConfig, TestConnectionResult } from '@shared/types';

export interface SaveLlmPayload {
  provider: LlmProvider;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  embeddingQueryPrefix?: string;
  embeddingPassagePrefix?: string;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
  temperature?: number | null;
  topP?: number | null;
  topK?: number | null;
}

export interface ListModelsPayload {
  provider: LlmProvider;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
  modelType?: 'chat' | 'embedding' | 'reranker';
}

export interface ListModelsResult {
  models: string[];
  dynamic: boolean;
}

export interface LoadModelPayload {
  provider: LlmProvider;
  model: string;
  ollamaBaseUrl?: string;
  lmStudioBaseUrl?: string;
}

export interface BaseUrlHealthPayload {
  kind: 'ollama' | 'lmstudio';
  url: string;
}

export interface BaseUrlHealthResult {
  ok: boolean;
  error?: string;
}

export const configApi = {
  getAbstractConfig: () => api.get<AbstractConfig>('/api/config/abstract'),
  saveAbstractConfig: (payload: AbstractConfig) => api.put<AbstractConfig>('/api/config/abstract', payload),
  getLlmConfig: () => api.get<LlmConfig>('/api/config/llm'),
  getLlmStatus: () => api.get<LlmStatus>('/api/config/llm/status'),
  saveLlmConfig: (payload: SaveLlmPayload) => api.put<LlmConfig>('/api/config/llm', payload),
  testLlmConnection: () => api.post<TestConnectionResult>('/api/config/llm/test'),
  probeBaseUrlHealth: (payload: BaseUrlHealthPayload) =>
    api.post<BaseUrlHealthResult>('/api/config/llm/base-url-health', payload),
  listModels: (payload: ListModelsPayload) =>
    api.post<ListModelsResult>('/api/config/llm/models', payload),
  loadModel: (payload: LoadModelPayload) =>
    api.post<void>('/api/config/llm/load-model', payload),
  getRerankerConfig: () => api.get<RerankerConfig>('/api/config/reranker'),
  saveRerankerConfig: (payload: RerankerConfig) => api.put<RerankerConfig>('/api/config/reranker', payload),
};
