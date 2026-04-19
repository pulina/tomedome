import { getChunks, getAbstracts, markBookEmbedded } from './book-service';
import { setJobStarted, updateProgress } from './job-queue';
import { saveEmbeddings, saveAbstractEmbeddings } from './vector-store';
import { getAdapter } from '../llm';
import { getLlmConfig, getApiKeyPlaintext, getEmbeddingModel } from './config-service';

const BATCH_SIZE = 20;

export async function runEmbeddingGeneration(
  jobId: string,
  bookId: string,
  signal: AbortSignal,
): Promise<void> {
  const chunks = getChunks(bookId);
  if (chunks.length === 0) return;

  const cfg = getLlmConfig();
  if (!cfg.provider) throw new Error('LLM not configured');

  const adapter = getAdapter(cfg, getApiKeyPlaintext());
  if (!adapter.embed) {
    throw new Error(`${cfg.provider} does not support embeddings`);
  }

  const embeddingModel = getEmbeddingModel();
  if (!embeddingModel) throw new Error('No embedding model configured');

  setJobStarted(jobId, embeddingModel);

  const total = chunks.length;
  let processed = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    if (signal.aborted) return;

    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.raw_text);

    updateProgress(
      jobId,
      processed,
      total,
      `Chunk ${processed + 1}–${Math.min(processed + batch.length, total)} of ${total}`,
    );

    const vectors = await adapter.embed(texts, embeddingModel, signal);
    if (signal.aborted) return;

    saveEmbeddings(
      batch.flatMap((chunk, idx) => {
        const vector = vectors[idx];
        if (!vector) return [];
        return [{ chunkId: chunk.id, vector, model: embeddingModel }];
      }),
    );

    processed += batch.length;
    updateProgress(jobId, processed, total, `Chunk ${processed} of ${total}`);
  }

  markBookEmbedded(bookId, embeddingModel);
}

const ABSTRACT_LEVELS_TO_EMBED = ['chapter_detailed', 'chapter_short', 'book'];

/**
 * Generate and store embeddings for all abstracts of a book.
 * Called automatically at the end of abstract generation so that
 * chapter-level summaries are searchable alongside raw chunks (RAPTOR-inspired).
 */
export async function runAbstractEmbeddingGeneration(
  bookId: string,
  signal: AbortSignal,
): Promise<void> {
  const abstracts = getAbstracts(bookId).filter((a) =>
    ABSTRACT_LEVELS_TO_EMBED.includes(a.level),
  );
  if (abstracts.length === 0) return;

  const cfg = getLlmConfig();
  if (!cfg.provider) return;

  const adapter = getAdapter(cfg, getApiKeyPlaintext());
  if (!adapter.embed) return;

  const embeddingModel = getEmbeddingModel();
  if (!embeddingModel) return;

  for (let i = 0; i < abstracts.length; i += BATCH_SIZE) {
    if (signal.aborted) return;

    const batch = abstracts.slice(i, i + BATCH_SIZE);
    const texts = batch.map((a) => a.content);
    const vectors = await adapter.embed(texts, embeddingModel, signal);
    if (signal.aborted) return;

    saveAbstractEmbeddings(
      batch.flatMap((abstract, idx) => {
        const vector = vectors[idx];
        if (!vector) return [];
        return [{ abstractId: abstract.id, vector, model: embeddingModel }];
      }),
    );
  }
}
