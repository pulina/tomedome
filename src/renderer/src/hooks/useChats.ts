import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Chat } from '@shared/types';
import { chatApi } from '../api/chat-api';

interface ChatsContextValue {
  chats: Chat[];
  refresh: () => Promise<void>;
  upsert: (chat: Chat) => void;
  remove: (id: string) => void;
}

export const ChatsContext = createContext<ChatsContextValue | null>(null);

export function useChatsContextValue(): ChatsContextValue {
  const [chats, setChats] = useState<Chat[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await chatApi.list();
      setChats(list);
    } catch {
      // swallow — sidebar empty state is acceptable while backend boots
    }
  }, []);

  const upsert = useCallback((chat: Chat) => {
    setChats((prev) => {
      const idx = prev.findIndex((c) => c.id === chat.id);
      const next = idx >= 0 ? [...prev] : [chat, ...prev];
      if (idx >= 0) next[idx] = chat;
      // Keep sorted by updatedAt desc.
      next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { chats, refresh, upsert, remove };
}

export function useChats(): ChatsContextValue {
  const ctx = useContext(ChatsContext);
  if (!ctx) throw new Error('useChats must be used inside ChatsContext.Provider');
  return ctx;
}
