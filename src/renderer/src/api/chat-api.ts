import { api } from './client';
import type {
  Chat,
  ChatContextAvailability,
  ChatMessage,
  ChatMessagesResponse,
  LlmCall,
  LlmCallPurpose,
  LogLevel,
} from '@shared/types';

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
    api.get<ChatMessagesResponse>(`/api/chats/${encodeURIComponent(id)}/messages`),
  getLlmCall: (id: string) => api.get<LlmCall>(`/api/logs/llm/${encodeURIComponent(id)}`),
  compact: (id: string) => api.post<{ compactionMessage: ChatMessage }>(`/api/chats/${encodeURIComponent(id)}/compact`),
  deleteMessagesFrom: (chatId: string, messageId: string) =>
    api.del(`/api/chats/${encodeURIComponent(chatId)}/messages/from/${encodeURIComponent(messageId)}`),
};

export const logsApi = {
  app: (levels: LogLevel[] | undefined, limit = 500) => {
    const qs = new URLSearchParams();
    if (levels !== undefined && levels.length > 0) qs.set('levels', levels.join(','));
    qs.set('limit', String(limit));
    return api.get<Array<Record<string, unknown>>>(`/api/logs/app?${qs.toString()}`);
  },
  llm: (limit = 200, purposes?: LlmCallPurpose[]) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (purposes?.length) qs.set('purposes', purposes.join(','));
    return api.get<LlmCall[]>(`/api/logs/llm?${qs.toString()}`);
  },
};
