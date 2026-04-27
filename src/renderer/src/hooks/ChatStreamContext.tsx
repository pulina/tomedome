import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import type { ChatMessage } from '@shared/types';
import { ApiError } from '../api/api-error';
import { resolveBaseUrl } from '../api/client';

export interface StreamCallbacks {
  onTitle?: (title: string, forChatId: string) => void;
  onUserMessage?: (msg: ChatMessage) => void;
  onAssistantMessage?: (msg: ChatMessage) => void;
}

export interface ChatStreamPageBinding {
  chatId: string;
  seriesId: string | null;
  callbacks: StreamCallbacks;
}

export interface ChatStreamContextValue {
  setPageBinding: (b: ChatStreamPageBinding | null) => void;
  send: (content: string) => Promise<void>;
  stop: () => void;
  streaming: boolean;
  activeStreamChatId: string | null;
  streamingText: string;
  thinkingSeconds: number;
  toolEvents: string[];
  messageToolEvents: Record<string, string[]>;
  hydrateMessageToolEvents: (map: Record<string, string[]>) => void;
  error: string | null;
  errorOriginChatId: string | null;
  lastPromptTokens: number | null;
  seedPromptTokens: (n: number | null) => void;
}

const ChatStreamContext = createContext<ChatStreamContextValue | null>(null);

export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const [streaming, setStreaming] = useState(false);
  const [activeStreamChatId, setActiveStreamChatId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [toolEvents, setToolEvents] = useState<string[]>([]);
  const [messageToolEvents, setMessageToolEvents] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [errorOriginChatId, setErrorOriginChatId] = useState<string | null>(null);
  const [lastPromptTokens, setLastPromptTokens] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pageBindingRef = useRef<ChatStreamPageBinding | null>(null);
  const viewingChatIdRef = useRef<string | null>(null);
  const pendingToolEventsRef = useRef<string[]>([]);
  const thinkStartRef = useRef<number | null>(null);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);

  const setPageBinding = useCallback((b: ChatStreamPageBinding | null) => {
    if (b && pageBindingRef.current?.chatId !== b.chatId) {
      setError(null);
      setErrorOriginChatId(null);
    }
    pageBindingRef.current = b;
    viewingChatIdRef.current = b?.chatId ?? null;
  }, []);

  // Only fire when the thinking↔text phase flips, not on every token arrival.
  const isThinkingPhase = streaming && !streamingText;
  useEffect(() => {
    if (!isThinkingPhase) {
      setThinkingSeconds(0);
      return;
    }
    if (thinkStartRef.current == null) return;
    const tick = () => {
      const t0 = thinkStartRef.current;
      if (t0 != null) setThinkingSeconds(Math.floor((Date.now() - t0) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isThinkingPhase]);

  const seedPromptTokens = useCallback((n: number | null) => setLastPromptTokens(n), []);

  const hydrateMessageToolEvents = useCallback((map: Record<string, string[]>) => {
    setMessageToolEvents(map);
  }, []);

  const send = useCallback(async (content: string) => {
    const b = pageBindingRef.current;
    if (!b?.chatId) return;
    if (streaming) return;
    const streamOwnerId = b.chatId;
    const seriesId = b.seriesId;
    setError(null);
    setErrorOriginChatId(null);
    setStreamingText('');
    setToolEvents([]);
    pendingToolEventsRef.current = [];
    thinkStartRef.current = Date.now();
    setStreaming(true);
    setActiveStreamChatId(streamOwnerId);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const base = await resolveBaseUrl();
      const res = await fetch(`${base}/api/chats/${encodeURIComponent(streamOwnerId)}/messages`, {
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
        const cbs = pageBindingRef.current?.callbacks;
        try {
          const obj = JSON.parse(data);
          if (event === 'token' && typeof obj === 'string') {
            accumulated += obj;
            flushSync(() => {
              setStreamingText(accumulated.trimStart());
            });
          } else if (event === 'tool_use') {
            const label = obj.label as string;
            flushSync(() => {
              pendingToolEventsRef.current = [...pendingToolEventsRef.current, label];
              setToolEvents((prev) => [...prev, label]);
            });
          } else if (event === 'user-message') {
            flushSync(() => {
              cbs?.onUserMessage?.(obj as ChatMessage);
            });
          } else if (event === 'title') {
            cbs?.onTitle?.(obj.title, streamOwnerId);
          } else if (event === 'done') {
            if (typeof obj.promptTokens === 'number' && streamOwnerId === viewingChatIdRef.current) {
              setLastPromptTokens(obj.promptTokens);
            }
            const tools = pendingToolEventsRef.current;
            if (tools.length > 0) {
              setMessageToolEvents((prev) => ({ ...prev, [obj.messageId as string]: tools }));
            }
            setStreaming(false);
            setActiveStreamChatId(null);
            setStreamingText('');
            cbs?.onAssistantMessage?.({
              id: obj.messageId,
              chatId: streamOwnerId,
              role: 'assistant',
              content: accumulated,
              llmCallId: obj.llmCallId ?? null,
              chunksReferenced: [],
              createdAt: new Date().toISOString(),
            });
            if (obj.error) {
              setError(obj.error);
              setErrorOriginChatId(streamOwnerId);
            }
          } else if (event === 'error') {
            setError(obj.error ?? 'unknown error');
            setErrorOriginChatId(streamOwnerId);
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('aborted');
        setErrorOriginChatId(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setErrorOriginChatId(streamOwnerId);
      }
    } finally {
      thinkStartRef.current = null;
      setStreaming(false);
      setActiveStreamChatId(null);
      setStreamingText('');
      abortRef.current = null;
    }
  }, [streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const value = useMemo<ChatStreamContextValue>(
    () => ({
      setPageBinding,
      send,
      stop,
      streaming,
      activeStreamChatId,
      streamingText,
      thinkingSeconds,
      toolEvents,
      messageToolEvents,
      hydrateMessageToolEvents,
      error,
      errorOriginChatId,
      lastPromptTokens,
      seedPromptTokens,
    }),
    [
      setPageBinding,
      send,
      stop,
      streaming,
      activeStreamChatId,
      streamingText,
      thinkingSeconds,
      toolEvents,
      messageToolEvents,
      hydrateMessageToolEvents,
      error,
      errorOriginChatId,
      lastPromptTokens,
      seedPromptTokens,
    ],
  );

  return <ChatStreamContext.Provider value={value}>{children}</ChatStreamContext.Provider>;
}

export function useChatStreamContext(): ChatStreamContextValue {
  const v = useContext(ChatStreamContext);
  if (!v) throw new Error('useChatStreamContext requires ChatStreamProvider');
  return v;
}

export function useChatStream(
  chatId: string | null,
  seriesId: string | null,
  callbacks: StreamCallbacks,
) {
  const {
    setPageBinding,
    send,
    stop,
    streaming,
    activeStreamChatId,
    streamingText,
    thinkingSeconds,
    toolEvents,
    messageToolEvents,
    hydrateMessageToolEvents,
    error,
    errorOriginChatId,
    lastPromptTokens,
    seedPromptTokens,
  } = useChatStreamContext();

  const binding = useMemo(
    () =>
      chatId
        ? {
            chatId,
            seriesId,
            callbacks,
          }
        : null,
    [chatId, seriesId, callbacks],
  );

  useLayoutEffect(() => {
    if (!binding) {
      setPageBinding(null);
      return;
    }
    setPageBinding(binding);
  }, [binding, setPageBinding]);

  useEffect(
    () => () => {
      setPageBinding(null);
    },
    [setPageBinding],
  );

  return {
    send,
    stop,
    streaming,
    activeStreamChatId,
    streamingText,
    thinkingSeconds,
    toolEvents,
    messageToolEvents,
    hydrateMessageToolEvents,
    error,
    errorOriginChatId,
    lastPromptTokens,
    seedPromptTokens,
  } as const;
}
