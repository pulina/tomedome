import {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Virtuoso } from 'react-virtuoso';
import { useNavigate, useParams } from 'react-router-dom';
import type { ChatContextAvailability, ChatMessage } from '@shared/types';
import { chatApi } from '../api/chat-api';
import { useChats } from '../hooks/useChats';
import { useInspector } from '../hooks/useInspector';
import { useChatStream } from '../hooks/useChatStream';
import { useSelectedSeries } from '../hooks/useSelectedSeries';
import logoUrl from '../assets/logo_small.svg';
import {
  ChatContextSourcesBar,
  CtxTokenPill,
  estimateCtxTokens,
  MessageBubble,
} from './ChatPageContextPanel';
import styles from './ChatPage.module.css';

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { chats, refresh, upsert } = useChats();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [compacting, setCompacting] = useState(false);
  const [contextAvail, setContextAvail] = useState<ChatContextAvailability | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const { openInspector } = useInspector();
  const { selectedSeriesId } = useSelectedSeries();

  useEffect(() => {
    if (!chatId || selectedSeriesId == null) {
      setContextAvail(null);
      return;
    }
    const seriesId = selectedSeriesId;
    let cancelled = false;
    function loadContext() {
      chatApi
        .getContextAvailability(seriesId)
        .then((c) => {
          if (!cancelled && c) setContextAvail(c);
        })
        .catch(() => {
          if (!cancelled) setContextAvail(null);
        });
    }
    loadContext();
    const onVis = () => {
      if (document.visibilityState === 'visible') loadContext();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [chatId, selectedSeriesId]);

  const chatIdRef = useRef(chatId);
  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  const addAssistantMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (msg.chatId !== chatIdRef.current) return prev;
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);
  const addUserMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      if (msg.chatId !== chatIdRef.current) return prev;
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);
  const onTitle = useCallback(
    (title: string, forChatId: string) => {
      const existing = chats.find((c) => c.id === forChatId);
      if (existing) upsert({ ...existing, title, titleStatus: 'determined' });
    },
    [chats, upsert],
  );

  // Stable object reference — prevents useChatStream's binding memo from firing on every render.
  const chatStreamCallbacks = useMemo(
    () => ({ onUserMessage: addUserMessage, onAssistantMessage: addAssistantMessage, onTitle }),
    [addUserMessage, addAssistantMessage, onTitle],
  );

  const {
    send,
    stop,
    streaming,
    activeStreamChatId,
    streamingText,
    toolEvents,
    messageToolEvents,
    error,
    errorOriginChatId,
    lastPromptTokens,
    seedPromptTokens,
    hydrateMessageToolEvents,
    thinkingSeconds,
  } = useChatStream(chatId ?? null, selectedSeriesId ?? null, chatStreamCallbacks);

  const streamVisibleHere = Boolean(
    streaming && activeStreamChatId != null && activeStreamChatId === chatId,
  );
  const streamTail = streamVisibleHere ? streamingText : '';

  const isThinking = streamVisibleHere && !streamingText;

  const lastMsg = !streamVisibleHere && messages.length > 0 ? messages[messages.length - 1] : null;
  const hasEmptyAssistant = lastMsg?.role === 'assistant' && !lastMsg.content.trim();

  // Server persists the assistant after tokens, then awaits title before `done`. listMessages
  // can return that row while the SSE is still open — same text also appears in the stream
  // footer; hide the duplicate list row until streaming ends.
  const displayMessages = useMemo(() => {
    if (!streamVisibleHere || messages.length === 0) return messages;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') return messages.slice(0, -1);
    return messages;
  }, [messages, streamVisibleHere]);

  // Reset messages when chatId changes.
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    chatApi
      .listMessages(chatId)
      .then((payload) => {
        if (cancelled) return;
        const msgs = payload.messages;
        setMessages(msgs);
        hydrateMessageToolEvents(payload.toolEventLabels);
        // Only look for the last assistant message after the last compaction marker.
        // Seeding from a message before compaction would restore the old (large) token count.
        const lastCompactionIdx = msgs.map((m) => m.role).lastIndexOf('compaction');
        const afterCompaction = lastCompactionIdx >= 0 ? msgs.slice(lastCompactionIdx + 1) : msgs;
        const lastAssistant = [...afterCompaction].reverse().find((m) => m.role === 'assistant' && m.llmCallId);
        if (lastAssistant?.llmCallId) {
          chatApi.getLlmCall(lastAssistant.llmCallId).then((call) => {
            if (!cancelled && call.promptTokens != null) seedPromptTokens(call.promptTokens);
          }).catch(() => {/* ignore */});
        }
      })
      .catch(() => {
        if (!cancelled) navigate('/chat');
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, navigate, seedPromptTokens, hydrateMessageToolEvents]);

  // After stream completes, refresh the chats list so sidebar picks up new updatedAt.
  useEffect(() => {
    if (!streaming && messages.length > 0) {
      void refresh();
    }
  }, [streaming, messages.length, refresh]);

  async function handleCreate() {
    const chat = await chatApi.create();
    upsert(chat);
    navigate(`/chat/${chat.id}`);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || streaming || !chatId) return;
    setInput('');
    const currentChat = chats.find((c) => c.id === chatId);
    if (currentChat && messages.length === 0 && currentChat.title === 'Unknown') {
      upsert({ ...currentChat, title: content.slice(0, 60) });
    }
    await send(content);
  }

  async function handleCompact() {
    if (!chatId || compacting || streamVisibleHere) return;
    setCompacting(true);
    seedPromptTokens(null); // reset to estimate mode immediately, synchronously with setCompacting
    try {
      const { compactionMessage } = await chatApi.compact(chatId);
      setMessages((prev) => [...prev, compactionMessage]);
    } catch {
      // ignore — user can retry
    } finally {
      setCompacting(false);
    }
  }

  const handleRetryConfirm = useCallback(
    async (messageId: string, content: string) => {
      if (!chatId || streaming) return;
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      await chatApi.deleteMessagesFrom(chatId, messageId);
      setMessages((prev) => prev.slice(0, idx));
      await send(content);
    },
    [chatId, messages, streaming, send],
  );

  const handleRetryLast = useCallback(async () => {
    if (!chatId || streaming) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const idx = messages.findIndex((m) => m.id === lastUser.id);
    await chatApi.deleteMessagesFrom(chatId, lastUser.id);
    setMessages((prev) => prev.slice(0, idx));
    await send(lastUser.content);
  }, [chatId, messages, streaming, send]);

  if (!chatId) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyCard}>
          <div className={styles.emptyTitle}>Inscribe your inquiry</div>
          <div className={styles.emptySub}>no inquiry selected</div>
          <button type="button" className={styles.emptyBtn} onClick={handleCreate}>
            ⊕ New Inquiry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.messages} ref={setScrollEl}>
        {scrollEl && (
          <Virtuoso
            customScrollParent={scrollEl}
            data={displayMessages}
            followOutput="auto"
            initialTopMostItemIndex={displayMessages.length > 0 ? displayMessages.length - 1 : 0}
            itemContent={(idx, m) =>
              m.role === 'compaction' ? (
                <div className={styles.compactionMarker}>
                  <span className={styles.compactionMarkerIcon}>◈</span>
                  context compacted
                </div>
              ) : (
                <MessageBubble
                  message={m}
                  toolEvents={messageToolEvents[m.id]}
                  onInspect={openInspector}
                  onRetryConfirm={m.role === 'user' ? handleRetryConfirm : undefined}
                  messagesAfterCount={displayMessages.slice(idx + 1).filter((msg) => msg.role !== 'compaction').length}
                  disabled={streaming}
                />
              )
            }
            components={{
              Footer: () =>
                streamVisibleHere ? (
                  <div className={styles.msg}>
                    <div className={`${styles.avatar} ${styles.avatarAi}`}>
                      <img src={logoUrl} alt="TomeDome" className={styles.avatarImg} />
                    </div>
                    <div className={styles.msgBody}>
                      {toolEvents.length > 0 && (
                        <div className={styles.toolEvents}>
                          {toolEvents.map((label, i) => (
                            <div key={i} className={styles.toolEvent}>
                              <span className={styles.toolEventIcon}>◈</span>
                              {label}
                            </div>
                          ))}
                        </div>
                      )}
                      {isThinking && (
                        <div className={`${styles.bubble} ${styles.bubbleAi} ${styles.bubbleThinking}`}>
                          <span className={styles.thinkingDot} />
                          <span className={styles.thinkingDot} />
                          <span className={styles.thinkingDot} />
                          <span className={styles.thinkingTimer}>
                            {thinkingSeconds > 0 ? `${thinkingSeconds}s` : ''}
                          </span>
                        </div>
                      )}
                      {streamTail && (
                        <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                          {streamTail}
                          <span className={styles.cursor} />
                        </div>
                      )}
                    </div>
                  </div>
                ) : null,
            }}
          />
        )}
      </div>

      {(error && error !== 'aborted' && errorOriginChatId === chatId) || hasEmptyAssistant ? (
        <div className={styles.errorBar}>
          <span>{error && error !== 'aborted' && errorOriginChatId === chatId ? `✗ ${error}` : '⊘ empty response'}</span>
          {!streaming && (
            <button type="button" className={styles.errorRetryBtn} onClick={handleRetryLast}>
              ↺ retry
            </button>
          )}
        </div>
      ) : null}

      <div className={styles.composerWrap}>
        {contextAvail ? (
          <ChatContextSourcesBar
            data={contextAvail}
            ctxTokens={displayMessages.length > 0 ? (lastPromptTokens ?? estimateCtxTokens(displayMessages, streamTail)) : undefined}
            ctxExact={lastPromptTokens !== null}
            onCompact={messages.length > 0 ? handleCompact : undefined}
            compacting={compacting}
            disabled={streamVisibleHere || compacting}
          />
        ) : displayMessages.length > 0 ? (
          <div className={styles.contextBar}>
            <CtxTokenPill
              tokens={lastPromptTokens ?? estimateCtxTokens(displayMessages, streamTail)}
              exact={lastPromptTokens !== null}
              onCompact={handleCompact}
              compacting={compacting}
              disabled={streamVisibleHere || compacting}
            />
          </div>
        ) : null}
        <div className={styles.composer}>
          <textarea
            className={styles.input}
            placeholder="Inscribe your inquiry…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={2}
            disabled={streamVisibleHere}
          />
          {/* `streaming` (not `streamVisibleHere`) — Stop must work even when the stream
              belongs to a different chat tab so the user can abort a background request. */}
          {streaming ? (
            <button type="button" className={styles.stopBtn} onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Transmit
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
