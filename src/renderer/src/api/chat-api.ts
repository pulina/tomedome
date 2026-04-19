import { api } from './client';
import type { Chat, ChatContextAvailability, ChatMessage, LlmCall } from '@shared/types';

export const chatApi = {
  list: () => api.get<Chat[]>('/api/chats'),
  getContextAvailability: (seriesId: string) => {
    const qs = new URLSearchParams({ seriesId });
    return api.get<ChatContextAvailability>(`/api/chats/context-availability?${qs.toString()}`);
  },
  create: () => api.post<Chat>('/api/chats'),
  remove: (id: string) => api.del(`/api/chats/${encodeURIComponent(id)}`),
  renameChat: (id: string, title: string) =>
    api.put<Chat>(`/api/chats/${encodeURIComponent(id)}/title`, { title }),
  listMessages: (id: string) =>
    api.get<ChatMessage[]>(`/api/chats/${encodeURIComponent(id)}/messages`),
  getLlmCall: (id: string) => api.get<LlmCall>(`/api/logs/llm/${encodeURIComponent(id)}`),
  compact: (id: string) => api.post<{ compactionMessage: ChatMessage }>(`/api/chats/${encodeURIComponent(id)}/compact`),
};

export const logsApi = {
  app: (level?: string, limit = 500) => {
    const qs = new URLSearchParams();
    if (level) qs.set('level', level);
    qs.set('limit', String(limit));
    return api.get<Array<Record<string, unknown>>>(`/api/logs/app?${qs.toString()}`);
  },
  llm: (limit = 200) =>
    api.get<LlmCall[]>(`/api/logs/llm?limit=${limit}`),
};
