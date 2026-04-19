import {
  KeyboardEvent,
  useCallback,
  useEffect,
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

  const addAssistantMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);
  const addUserMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);
  const onTitle = useCallback(
    (title: string) => {
      if (!chatId) return;
      const existing = chats.find((c) => c.id === chatId);
      if (existing) upsert({ ...existing, title, titleStatus: 'determined' });
    },
    [chatId, chats, upsert],
  );

  const { send, stop, streaming, streamingText, toolEvents, messageToolEvents, error, lastPromptTokens, seedPromptTokens } = useChatStream(chatId ?? null, selectedSeriesId ?? null, {
    onUserMessage: addUserMessage,
    onAssistantMessage: addAssistantMessage,
    onTitle,
  });

  // Thinking timer: counts seconds from send until first text token arrives.
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  useEffect(() => {
    if (!streaming) {
      setThinkingSeconds(0);
      return;
    }
    if (streamingText) return; // text arrived — stop counting
    setThinkingSeconds(0);
    const start = Date.now();
    const id = setInterval(() => {
      setThinkingSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [streaming, streamingText]);

  const isThinking = streaming && !streamingText;

  // Reset messages when chatId changes.
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    chatApi
      .listMessages(chatId)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(msgs);
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
  }, [chatId, navigate, seedPromptTokens]);

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
    await send(content);
  }

  async function handleCompact() {
    if (!chatId || compacting || streaming) return;
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
            data={messages}
            followOutput="auto"
            initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
            itemContent={(_, m) =>
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
                />
              )
            }
            components={{
              Footer: () =>
                streaming ? (
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
                      {streamingText && (
                        <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                          {streamingText}
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

      {error && error !== 'aborted' && (
        <div className={styles.errorBar}>✗ {error}</div>
      )}

      <div className={styles.composerWrap}>
        {contextAvail ? (
          <ChatContextSourcesBar
            data={contextAvail}
            ctxTokens={messages.length > 0 ? (lastPromptTokens ?? estimateCtxTokens(messages, streamingText)) : undefined}
            ctxExact={lastPromptTokens !== null}
            onCompact={messages.length > 0 ? handleCompact : undefined}
            compacting={compacting}
            disabled={streaming || compacting}
          />
        ) : messages.length > 0 ? (
          <div className={styles.contextBar}>
            <CtxTokenPill
              tokens={lastPromptTokens ?? estimateCtxTokens(messages, streamingText)}
              exact={lastPromptTokens !== null}
              onCompact={handleCompact}
              compacting={compacting}
              disabled={streaming || compacting}
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
            disabled={streaming}
          />
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
