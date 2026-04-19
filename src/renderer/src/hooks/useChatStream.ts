import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '@shared/types';
import { ApiError } from '../api/api-error';
import { resolveBaseUrl } from '../api/client';

export interface StreamCallbacks {
  onTitle?: (title: string) => void;
  onUserMessage?: (msg: ChatMessage) => void;
  onAssistantMessage?: (msg: ChatMessage) => void;
}

/**
 * Owns the POST /api/chats/:id/messages streaming lifecycle.
 * Does NOT own the historical message list — page supplies that.
 */
export function useChatStream(chatId: string | null, seriesId: string | null, callbacks: StreamCallbacks = {}) {
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  // Persists tool events after streaming ends, keyed by messageId
  const [messageToolEvents, setMessageToolEvents] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [lastPromptTokens, setLastPromptTokens] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Ref so handleEvent closure can read current tool events without stale closure
  const pendingToolEventsRef = useRef<string[]>([]);

  const send = useCallback(
    async (content: string) => {
      if (!chatId) return;
      if (streaming) return;
      setError(null);
      setStreamingText('');
      setToolEvents([]);
      pendingToolEventsRef.current = [];
      setStreaming(true);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const base = await resolveBaseUrl();
        const res = await fetch(`${base}/api/chats/${encodeURIComponent(chatId)}/messages`, {
          method: 'POST',
          signal: abort.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content, seriesId }),
        });
        if (!res.ok || !res.body) {
          throw new ApiError(res.status, `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event: string | null = null;
            const dataLines: string[] = [];
            for (const line of raw.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const data = dataLines.join('\n');
            if (!event || !data) continue;
            handleEvent(event, data);
          }
        }

        function handleEvent(event: string, data: string) {
          try {
            const obj = JSON.parse(data);
            if (event === 'token' && typeof obj === 'string') {
              accumulated += obj;
              setStreamingText(accumulated.trimStart());
            } else if (event === 'tool_use') {
              const label = obj.label as string;
              pendingToolEventsRef.current = [...pendingToolEventsRef.current, label];
              setToolEvents((prev) => [...prev, label]);
            } else if (event === 'user-message') {
              callbacks.onUserMessage?.(obj as ChatMessage);
            } else if (event === 'title') {
              callbacks.onTitle?.(obj.title);
            } else if (event === 'done') {
              if (typeof obj.promptTokens === 'number') setLastPromptTokens(obj.promptTokens);
              const tools = pendingToolEventsRef.current;
              if (tools.length > 0) {
                setMessageToolEvents((prev) => ({ ...prev, [obj.messageId as string]: tools }));
              }
              // Transition out of streaming state in the same batch as the final message,
              // so the Footer (streaming bubble) and the new message never coexist in a render.
              setStreaming(false);
              setStreamingText('');
              callbacks.onAssistantMessage?.({
                id: obj.messageId,
                chatId: chatId!,
                role: 'assistant',
                content: accumulated,
                llmCallId: obj.llmCallId ?? null,
                chunksReferenced: [],
                createdAt: new Date().toISOString(),
              });
              if (obj.error) setError(obj.error);
            } else if (event === 'error') {
              setError(obj.error ?? 'unknown error');
            }
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setError('aborted');
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setStreaming(false);
        setStreamingText('');
        abortRef.current = null;
      }
    },
    [chatId, streaming, callbacks],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const seedPromptTokens = useCallback((n: number | null) => setLastPromptTokens(n), []);

  return { send, stop, streaming, streamingText, toolEvents, messageToolEvents, error, lastPromptTokens, seedPromptTokens } as const;
}
