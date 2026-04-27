import { getAdapter } from '../llm';
import {
  getApiKeyPlaintext,
  getEmbeddingModel,
  getEmbeddingPassagePrefix,
  getEmbeddingQueryPrefix,
  getLlmConfig,
  getRerankerConfig,
} from './config-service';
import { bookEmbeddingProfileMismatch, withEmbeddingQueryPrefix } from '@shared/embedding-profile';
import { finaliseLlmCall, insertLlmCall } from './llm-call-log';
import { getChapterShortAbstracts, listBooks, type ChapterShortAbstract } from './book-service';
import type { Book } from '@shared/types';
import { searchAllForRag, searchChunksFts, searchAbstractsForRag } from './vector-store';
import type { RagResult, AbstractRagResult } from './vector-store';
import { getLogger } from '../lib/logger';
import type { LlmAdapter } from '../llm/types';
import type { Logger } from 'pino';

export interface RagContext {
  /** Formatted context block to prepend to the user message sent to the LLM. */
  contextBlock: string;
  /** IDs of the chunks that were surfaced — saved to chat_messages.chunks_referenced. */
  chunkIds: string[];
}

function bookHasEmbeddingsMatchingProfile(
  b: Book,
  embeddingModel: string | null,
  passagePrefix: string,
): boolean {
  if (b.chunkCount <= 0 || !b.embeddedAt) return false;
  return !bookEmbeddingProfileMismatch(b, embeddingModel, passagePrefix);
}

/**
 * True when query embedding + vector search over chunks can return rows for this scope
 * (adapter supports embed, model configured, at least one book has embedded chunks for current profile).
 */
export function isSemanticRetrievalOperational(
  seriesId: string | null,
  bookId: string | null = null,
): boolean {
  const cfg = getLlmConfig();
  const embeddingModel = getEmbeddingModel();
  const passagePrefix = getEmbeddingPassagePrefix();
  const adapter = getAdapter(cfg, getApiKeyPlaintext());
  if (!adapter.embed || !embeddingModel) return false;

  let books = listBooks();
  if (bookId) books = books.filter((x) => x.id === bookId);
  else if (seriesId) books = books.filter((x) => x.seriesId === seriesId);

  return books.some((b) => bookHasEmbeddingsMatchingProfile(b, embeddingModel, passagePrefix));
}

/** Dense retrieval breadth before merge/rerank. */
const SEMANTIC_TOP_N = 8;
/** Keyword hits to blend in (smaller — FTS is a narrow recall channel). */
const FTS_TOP_N = 4;
/** Chunks passed to the prompt after merge (and after rerank if enabled). */
const MERGED_TOP_N = 8;
/** Extra chapter_detailed abstracts for RAPTOR-style coverage. */
const ABSTRACT_TOP_N = 3;

/**
 * Same passage can appear in semantic + FTS with different scores; keep the
 * stronger match so the prompt is not bloated with duplicate chunks.
 */
function mergeSemanticAndFtsByChunkId(semanticHits: RagResult[], ftsHits: RagResult[]): Map<string, RagResult> {
  const byId = new Map<string, RagResult>();
  for (const hit of [...semanticHits, ...ftsHits]) {
    const existing = byId.get(hit.chunkId);
    if (!existing || hit.score > existing.score) {
      byId.set(hit.chunkId, hit);
    }
  }
  return byId;
}

async function rerankWithAdapter(params: {
  userQuery: string;
  candidates: RagResult[];
  adapter: LlmAdapter;
  model: string;
  log: Logger;
}): Promise<RagResult[]> {
  const { userQuery, candidates, adapter, model, log } = params;
  const texts = candidates.map((r) => r.text);
  try {
    const scores = await adapter.rerank!(userQuery, texts, model);
    return candidates
      .map((r, i) => ({ ...r, score: scores[i] ?? r.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MERGED_TOP_N);
  } catch (err) {
    log.warn({ err }, 'rag-service: reranking failed, falling back to original scores');
    return candidates.slice(0, MERGED_TOP_N);
  }
}

function buildContextParts(params: {
  merged: RagResult[];
  chapterAbstracts: ChapterShortAbstract[];
  abstractMap: Map<string, ChapterShortAbstract>;
  novelAbstractHits: AbstractRagResult[];
}): string[] {
  const { merged, chapterAbstracts, abstractMap, novelAbstractHits } = params;
  const parts: string[] = ['## Relevant passages from your library\n'];

  for (const hit of merged) {
    const chapterLabel = hit.chapterTitle
      ? `Chapter ${hit.chapterNumber ?? '?'}: ${hit.chapterTitle}`
      : hit.chapterNumber != null
        ? `Chapter ${hit.chapterNumber}`
        : 'Unknown chapter';
    parts.push(`### "${hit.bookTitle}" — ${chapterLabel} [chunk: ${hit.chunkId}]\n${hit.text}`);
  }

  if (chapterAbstracts.length > 0) {
    parts.push('\n## Chapter orientation\n');
    for (const abs of chapterAbstracts) {
      const key = `${abs.bookId}:${abs.chapterNumber}`;
      if (!abstractMap.has(key)) continue;
      const label = abs.chapterTitle
        ? `Chapter ${abs.chapterNumber} — "${abs.chapterTitle}" (${abs.bookTitle})`
        : `Chapter ${abs.chapterNumber} (${abs.bookTitle})`;
      parts.push(`### ${label}\n${abs.content}`);
    }
  }

  // RAPTOR-style abstract hits; skip chapters already covered by chunk retrieval + orientation.
  if (novelAbstractHits.length > 0) {
    parts.push('\n## Relevant chapter summaries\n');
    for (const hit of novelAbstractHits) {
      const chapterLabel = hit.chapterTitle
        ? `Chapter ${hit.chapterNumber ?? '?'}: ${hit.chapterTitle}`
        : hit.chapterNumber != null
          ? `Chapter ${hit.chapterNumber}`
          : 'Book summary';
      parts.push(`### "${hit.bookTitle}" — ${chapterLabel} [summary]\n${hit.text}`);
    }
  }

  return parts;
}

/**
 * Build a RAG context block for a user query.
 *
 * 1. Embeds the query (semantic search), vector search over chunks/abstracts, merges with FTS.
 * 2. Skips the entire RAG path (no query embedding, no FTS, no log) when the library
 *    has no chunk vectors matching the current embedding profile in scope — `search_text`
 *    in chat still works via tools.
 * 3. Merges results, deduplicates by chunkId, sorts by score, takes top MERGED_TOP_N.
 * 4. Fetches chapter_short abstracts for the chapters that appear in results.
 * 5. Formats everything into a context block ready to be prepended to the user message.
 *
 * Returns null when there is nothing to inject or an error occurs — the caller
 * should proceed with the plain user message in that case.
 */
export async function buildRagContext(userQuery: string, seriesId: string | null = null): Promise<RagContext | null> {
  const log = getLogger().child({ module: 'rag-service' });

  try {
    if (!isSemanticRetrievalOperational(seriesId)) {
      return null;
    }

    const cfg = getLlmConfig();
    const embeddingModel = getEmbeddingModel()!; // guaranteed non-null by isSemanticRetrievalOperational
    const queryPrefix = getEmbeddingQueryPrefix();
    const passagePrefix = getEmbeddingPassagePrefix();
    const adapter = getAdapter(cfg, getApiKeyPlaintext());

    let semanticHits: RagResult[] = [];
    let abstractHits: AbstractRagResult[] = [];

    try {
      const vectors = await adapter.embed(
        [withEmbeddingQueryPrefix(userQuery.trim(), queryPrefix)],
        embeddingModel,
      );
      const queryVector = vectors[0];
      if (queryVector) {
        semanticHits = searchAllForRag(queryVector, SEMANTIC_TOP_N, embeddingModel, seriesId, passagePrefix);
        abstractHits = searchAbstractsForRag(
          queryVector,
          ABSTRACT_TOP_N,
          ['chapter_detailed'],
          embeddingModel,
          seriesId,
          passagePrefix,
        );
      }
    } catch (err) {
      log.warn({ err }, 'rag-service: query embedding failed, using FTS merge only for this turn');
    }

    const ftsHits = searchChunksFts(userQuery, FTS_TOP_N, seriesId);

    const byId = mergeSemanticAndFtsByChunkId(semanticHits, ftsHits);

    if (byId.size === 0) {
      return null;
    }

    const ragCallId = insertLlmCall({
      chatId: null,
      purpose: 'rag',
      provider: cfg.provider ?? '',
      model: embeddingModel,
      requestJson: JSON.stringify({
        query: userQuery,
        embeddingModel,
        semantic: semanticHits.length,
        fts: ftsHits.length,
        abstractHits: abstractHits.length,
      }),
    });
    const ragStartMs = Date.now();

    const ragInputTokens = Math.round(userQuery.length / 4);

    const rerankerCfg = getRerankerConfig();
    const useReranker = rerankerCfg.enabled && rerankerCfg.model.length > 0 && !!adapter.rerank;
    const candidateN = useReranker
      ? Math.ceil(MERGED_TOP_N * rerankerCfg.topKMultiplier)
      : MERGED_TOP_N;

    let merged = [...byId.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, candidateN);

    if (useReranker) {
      merged = await rerankWithAdapter({
        userQuery,
        candidates: merged,
        adapter,
        model: rerankerCfg.model,
        log,
      });
    }

    // One orientation blurb per chapter — multiple chunks from the same chapter share chapter_short.
    const pairs = [
      ...new Map(
        merged
          .filter((r): r is RagResult & { chapterNumber: number } => r.chapterNumber !== null)
          .map((r) => [`${r.bookId}:${r.chapterNumber}`, { bookId: r.bookId, chapterNumber: r.chapterNumber }]),
      ).values(),
    ];
    const chapterAbstracts = getChapterShortAbstracts(pairs);
    const abstractMap = new Map(
      chapterAbstracts.map((a) => [`${a.bookId}:${a.chapterNumber}`, a]),
    );

    const coveredChapters = new Set(pairs.map((p) => `${p.bookId}:${p.chapterNumber}`));
    const novelAbstractHits = abstractHits.filter(
      (h) => !coveredChapters.has(`${h.bookId}:${h.chapterNumber ?? 'book'}`),
    );

    const parts = buildContextParts({
      merged,
      chapterAbstracts,
      abstractMap,
      novelAbstractHits,
    });

    finaliseLlmCall(ragCallId, {
      responseText: JSON.stringify({
        chunks: merged.map((r) => ({
          chunkId: r.chunkId,
          bookTitle: r.bookTitle,
          chapterNumber: r.chapterNumber,
          chapterTitle: r.chapterTitle,
          score: r.score,
          text: r.text,
        })),
        abstractHits: novelAbstractHits.map((h) => ({
          bookTitle: h.bookTitle,
          chapterNumber: h.chapterNumber,
          chapterTitle: h.chapterTitle,
          score: h.score,
          text: h.text,
        })),
      }),
      promptTokens: ragInputTokens,
      completionTokens: null,
      latencyMs: Date.now() - ragStartMs,
      error: null,
    });

    return {
      contextBlock: parts.join('\n\n'),
      chunkIds: merged.map((r) => r.chunkId),
    };
  } catch (err) {
    getLogger().warn({ err }, 'rag-service: buildRagContext failed, skipping RAG');
    return null;
  }
}

/**
 * Embed a model-formulated query and return the top semantic hits.
 * Returns null when semantic retrieval cannot run for this scope (no embed support or no usable vectors).
 */
export async function searchSemanticForTool(
  query: string,
  topN: number,
  bookId: string | null,
  seriesId: string | null,
): Promise<RagResult[] | null> {
  if (!isSemanticRetrievalOperational(seriesId, bookId)) return null;

  const cfg = getLlmConfig();
  const embeddingModel = getEmbeddingModel()!; // guaranteed non-null by isSemanticRetrievalOperational
  const queryPrefix = getEmbeddingQueryPrefix();
  const passagePrefix = getEmbeddingPassagePrefix();
  const adapter = getAdapter(cfg, getApiKeyPlaintext()); // adapter.embed guaranteed by isSemanticRetrievalOperational

  const vectors = await adapter.embed!(
    [withEmbeddingQueryPrefix(query.trim(), queryPrefix)],
    embeddingModel,
  );
  const queryVector = vectors[0];
  if (!queryVector) return [];

  const hits = searchAllForRag(queryVector, topN, embeddingModel, seriesId, passagePrefix);
  return bookId ? hits.filter((h) => h.bookId === bookId) : hits;
}
