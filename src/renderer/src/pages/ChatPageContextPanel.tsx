import type { ChatContextAvailability, ChatMessage } from '@shared/types';
import logoUrl from '../assets/logo_small.svg';
import styles from './ChatPage.module.css';

export function MessageBubble({
  message,
  toolEvents,
  onInspect,
}: {
  message: ChatMessage;
  toolEvents?: string[];
  onInspect: (id: string) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`${styles.msg} ${isUser ? styles.msgUser : ''}`}>
      <div className={`${styles.avatar} ${isUser ? styles.avatarUser : styles.avatarAi}`}>
        {isUser ? <UserIcon /> : <img src={logoUrl} alt="TomeDome" className={styles.avatarImg} />}
      </div>
      <div className={styles.msgBody}>
        {toolEvents && toolEvents.length > 0 && (
          <div className={styles.toolEvents}>
            {toolEvents.map((label, i) => (
              <div key={i} className={styles.toolEvent}>
                <span className={styles.toolEventIcon}>◈</span>
                {label}
              </div>
            ))}
          </div>
        )}
        <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAi}`}>
          {message.content}
        </div>
        {!isUser && message.llmCallId && (
          <button
            type="button"
            className={styles.inspector}
            onClick={() => onInspect(message.llmCallId!)}
          >
            ◈ inspect call
          </button>
        )}
      </div>
    </div>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.avatarSvg}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChatContextSourcesBar({ data, ctxTokens, ctxExact, onCompact, compacting, disabled }: {
  data: ChatContextAvailability;
  ctxTokens?: number;
  ctxExact?: boolean;
  onCompact?: () => void;
  compacting?: boolean;
  disabled?: boolean;
}) {
  const {
    bookCount,
    seriesAbstractMissingCount,
    seriesAbstractNotApplicable,
    seriesBucketCount,
    bookAbstractMissingCount,
    ragEligibleBookCount,
    ragEmbeddingMissingCount,
    ragModelMismatchCount,
    seriesScoped,
  } = data;

  const strikeSeries =
    !seriesAbstractNotApplicable &&
    (seriesScoped
      ? seriesAbstractMissingCount > 0
      : seriesBucketCount > 0 && seriesAbstractMissingCount === seriesBucketCount);
  const warnSeries =
    !seriesAbstractNotApplicable &&
    !seriesScoped &&
    seriesAbstractMissingCount > 0 &&
    seriesAbstractMissingCount < seriesBucketCount;

  const strikeBooks =
    bookCount > 0 && bookAbstractMissingCount === bookCount;
  const warnBooks =
    bookAbstractMissingCount > 0 && bookAbstractMissingCount < bookCount;

  const ragUnavailableCount = ragEmbeddingMissingCount + ragModelMismatchCount;
  const strikeRag =
    ragEligibleBookCount === 0 ||
    (ragEligibleBookCount > 0 && ragUnavailableCount === ragEligibleBookCount);
  const warnRag =
    ragEligibleBookCount > 0 &&
    ragUnavailableCount > 0 &&
    (ragUnavailableCount < ragEligibleBookCount || ragEligibleBookCount > 1);

  if (bookCount === 0) {
    return (
      <div className={styles.contextBar}>
        <span className={styles.contextBarEmpty}>
          {seriesScoped
            ? seriesAbstractNotApplicable
              ? 'Selected series is missing from the library — choose another in the sidebar.'
              : 'This series has no volumes yet — nothing to index for abstracts or RAG.'
            : 'Library is empty — no series list, abstracts, or RAG chunks for the model yet.'}
        </span>
        {ctxTokens !== undefined && (
          <CtxTokenPill
            tokens={ctxTokens}
            exact={ctxExact ?? false}
            onCompact={onCompact}
            compacting={compacting}
            disabled={disabled}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.contextBar} role="status">
      <span className={styles.contextBarLabel}>
        Chat can use{seriesScoped ? ' (selected series)' : ''}
      </span>
      <span className={styles.contextItems}>
        <ContextSourcePill
          label="Series abstract"
          struck={strikeSeries}
          warn={warnSeries}
          title={
            seriesScoped
              ? strikeSeries
                ? 'This series has no overview text in the catalogue.'
                : 'This series has a series abstract in the model catalogue.'
              : seriesAbstractNotApplicable
                ? 'No series contain books.'
                : strikeSeries
                  ? 'No series overview text in the catalogue for any series that has books.'
                  : warnSeries
                    ? 'Some series with books still lack a series abstract.'
                    : 'Every series that has books has a series abstract in context.'
          }
        />
        <span className={styles.contextSep} aria-hidden>
          ·
        </span>
        <ContextSourcePill
          label="Book abstracts"
          struck={strikeBooks}
          warn={warnBooks}
          title={
            seriesScoped
              ? strikeBooks
                ? 'No volume in this series has a finished book-level abstract yet.'
                : warnBooks
                  ? 'Some volumes in this series lack a book-level abstract.'
                  : 'Every volume in this series has a book-level abstract in context.'
              : strikeBooks
                ? 'No book has a finished book-level abstract yet.'
                : warnBooks
                  ? 'Some books lack a book-level abstract.'
                  : 'Every book has a book-level abstract in context.'
          }
        />
        <span className={styles.contextSep} aria-hidden>
          ·
        </span>
        <ContextSourcePill
          label="RAG"
          struck={strikeRag}
          warn={warnRag}
          title={
            seriesScoped
              ? ragEligibleBookCount === 0
                ? 'No chunks in this series — nothing to embed for retrieval.'
                : strikeRag
                  ? ragModelMismatchCount === ragEligibleBookCount
                    ? 'All volumes use embeddings from a different model — re-embed or allow override in the library.'
                    : ragModelMismatchCount > 0
                      ? 'All volumes with chunks are either not embedded or use a mismatched model.'
                      : 'Chunks exist but none are embedded yet.'
                  : warnRag
                    ? ragModelMismatchCount > 0
                      ? 'Some volumes have embeddings from a different model — re-embed or allow override in the library.'
                      : 'Some volumes with chunks are not embedded yet.'
                    : 'Chunks are embedded for retrieval (plus keyword search when configured).'
              : ragEligibleBookCount === 0
                ? 'No chunks in the library — nothing to embed.'
                : strikeRag
                  ? ragModelMismatchCount === ragEligibleBookCount
                    ? 'All books use embeddings from a different model — re-embed or allow override in the library.'
                    : ragModelMismatchCount > 0
                      ? 'All books with chunks are either not embedded or use a mismatched model.'
                      : 'Chunks exist but none are embedded yet.'
                  : warnRag
                    ? ragModelMismatchCount > 0
                      ? 'Some books have embeddings from a different model — re-embed or allow override in the library.'
                      : 'Some books with chunks are not embedded yet.'
                    : 'Chunks are embedded — retrieval can use vectors (plus keyword search when configured).'
          }
        />
      </span>
      {ctxTokens !== undefined && (
        <CtxTokenPill
          tokens={ctxTokens}
          exact={ctxExact ?? false}
          onCompact={onCompact}
          compacting={compacting}
          disabled={disabled}
        />
      )}
    </div>
  );
}

export function CtxTokenPill({ tokens, exact, onCompact, compacting, disabled }: {
  tokens: number;
  exact: boolean;
  onCompact?: () => void;
  compacting?: boolean;
  disabled?: boolean;
}) {
  const cls = tokens >= 1_000_000
    ? `${styles.contextTokens} ${styles.contextTokensDanger}`
    : tokens >= 200_000
      ? `${styles.contextTokens} ${styles.contextTokensWarn}`
      : styles.contextTokens;

  const title = exact
    ? 'Exact prompt token count reported by the model provider for the last request.'
    : 'Estimated conversation tokens (chars ÷ 4). Does not include system prompt or RAG chunks.';

  return (
    <span className={cls} title={title}>
      <span className={styles.ctxCount}>
        {exact ? '' : '~'}{formatCtxTokens(tokens)} ctx
      </span>
      <button
        type="button"
        className={styles.ctxCompactBtn}
        onClick={onCompact}
        disabled={disabled}
        title="Compact conversation to reduce context size"
      >
        {compacting ? '…' : 'compact'}
      </button>
    </span>
  );
}

export function estimateCtxTokens(messages: ChatMessage[], streamingText: string): number {
  // Only count from the last compaction marker onwards — it holds the summary.
  const lastCompactionIdx = messages.map((m) => m.role).lastIndexOf('compaction');
  const relevant = lastCompactionIdx >= 0 ? messages.slice(lastCompactionIdx) : messages;
  let chars = 0;
  for (const m of relevant) chars += m.content.length;
  chars += streamingText.length;
  return Math.round(chars / 4);
}

function formatCtxTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function ContextSourcePill({
  label,
  struck,
  warn,
  title,
}: {
  label: string;
  struck: boolean;
  warn: boolean;
  title: string;
}) {
  return (
    <span className={styles.contextPill} title={title}>
      <span
        className={`${styles.contextPillLabel} ${struck ? styles.contextPillStruck : ''}`}
      >
        {label}
      </span>
      {warn && (
        <span className={styles.contextWarnIcon} aria-label="Incomplete for some volumes">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 4.2v5M8 11.3v.1"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}
    </span>
  );
}
