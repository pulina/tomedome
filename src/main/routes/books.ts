import { FastifyInstance } from 'fastify';
import { chunkText, detectLanguage, getPreviewStats, parseFile, titleFromFilename } from '../services/ingest-service';
import { clearAbstracts, createBook, deleteBook, getAbstracts, getBook, listBooks, saveChunks, setBookEmbeddingOverride } from '../services/book-service';
import { createBookBackgroundJobIfIdle, enqueue } from '../services/job-queue';
import { runAbstractGeneration, runSeriesAbstractGeneration } from '../services/abstract-service';
import {
  abstractEmbeddingProfileBlockedReason,
  runAbstractEmbeddingGeneration,
  runEmbeddingGeneration,
} from '../services/embedding-service';
import { deleteBookAbstractEmbeddings, deleteBookEmbeddings, searchBookAbstractEmbeddings, searchBookEmbeddings } from '../services/vector-store';
import { getAdapter } from '../llm';
import {
  getApiKeyPlaintext,
  getEmbeddingModel,
  getEmbeddingQueryPrefix,
  getLlmConfig,
} from '../services/config-service';
import { withEmbeddingQueryPrefix } from '@shared/embedding-profile';
import type { ChunkingOptions } from '../../shared/types';
import { apiErr } from '../lib/api-errors';
import { schemas } from './schemas';

const BOOK_JOB_CONFLICT_BODY = apiErr(
  'conflict',
  'A background job is already queued or running for this book. Wait for it to finish or cancel it first.',
);

interface BookEnqueueJobBody {
  type: 'abstract_generation' | 'embedding_generation';
  chainAbstractGeneration?: boolean;
}

interface PreviewBody {
  filePath: string;
  chunkingOptions?: ChunkingOptions;
}

interface CreateBookBody {
  seriesId: string;
  filePath: string;
  title: string;
  author?: string;
  year?: number;
  genre?: string;
  language?: string;
  jobs?: string[];
  chunkingOptions?: ChunkingOptions;
  excludedChunkIndices?: number[];
  chapterTitleOverrides?: Record<string, string>;
}

export async function registerBookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: PreviewBody }>(
    '/api/books/preview',
    { schema: { body: schemas.bookPreviewBody } },
    async (req, reply) => {
      const { filePath, chunkingOptions } = req.body ?? {};
      if (!filePath) return reply.code(400).send(apiErr('validation', 'filePath required'));
      try {
        const text = await parseFile(filePath, chunkingOptions);
        const chunks = chunkText(text, chunkingOptions);
        if (chunks.length === 0)
          return reply.code(422).send(apiErr('unprocessable', 'No parseable content found'));
        return {
          stats: getPreviewStats(filePath, chunks),
          suggestedTitle: titleFromFilename(filePath),
          detectedLanguage: await detectLanguage(chunks),
        };
      } catch (err) {
        return reply
          .code(500)
          .send(apiErr('internal', err instanceof Error ? err.message : 'Parse failed'));
      }
    },
  );

  fastify.post<{ Body: CreateBookBody }>(
    '/api/books',
    { schema: { body: schemas.bookCreateBody } },
    async (req, reply) => {
      const {
        seriesId,
        filePath,
        title,
        author,
        year,
        genre,
        language,
        jobs: jobTypes = [],
        chunkingOptions,
        excludedChunkIndices,
        chapterTitleOverrides,
      } = req.body ?? {};
      if (!seriesId || !filePath || !title)
        return reply.code(400).send(apiErr('validation', 'seriesId, filePath and title required'));
      try {
        const text = await parseFile(filePath, chunkingOptions);
        const allChunks = chunkText(text, chunkingOptions);
        const excluded = new Set(excludedChunkIndices ?? []);
        let chunks = excluded.size > 0 ? allChunks.filter((_, i) => !excluded.has(i)) : allChunks;
        if (chapterTitleOverrides && Object.keys(chapterTitleOverrides).length > 0) {
          chunks = chunks.map((c) => {
            if (c.chapterNumber === null) return c;
            const override = chapterTitleOverrides[String(c.chapterNumber)];
            return override ? { ...c, chapterTitle: override } : c;
          });
        }
        if (chunks.length === 0)
          return reply.code(422).send(apiErr('unprocessable', 'No parseable content found'));
        const wordCount = chunks.reduce((a, c) => a + c.rawText.split(/\s+/).length, 0);
        const book = createBook({ seriesId, title, author, year, genre, language, filePath, wordCount });
        saveChunks(book.id, chunks);
        const createdJobs = [];
        const wantAbstract = jobTypes.includes('abstract_generation');
        const wantEmbed = jobTypes.includes('embedding_generation');
        const bookSeriesId = book.seriesId;

        if (wantAbstract && wantEmbed) {
          const job = createBookBackgroundJobIfIdle('abstract_generation', book.id, {
            ingestAbstractThenEmbed: true,
          });
          if (!job) return reply.code(409).send(BOOK_JOB_CONFLICT_BODY);
          enqueue(job.id, async (jobId, signal) => {
            await runAbstractGeneration(jobId, book.id, signal, { skipFinalAbstractEmbedding: true });
            if (!signal.aborted && bookSeriesId) {
              void runSeriesAbstractGeneration(bookSeriesId, new AbortController().signal);
            }
            if (!signal.aborted) {
              deleteBookEmbeddings(book.id);
              deleteBookAbstractEmbeddings(book.id);
              await runEmbeddingGeneration(jobId, book.id, signal);
              if (!signal.aborted) await runAbstractEmbeddingGeneration(book.id, signal);
            }
          });
          createdJobs.push(job);
        } else if (wantAbstract) {
          const job = createBookBackgroundJobIfIdle('abstract_generation', book.id);
          if (!job) return reply.code(409).send(BOOK_JOB_CONFLICT_BODY);
          enqueue(job.id, async (jobId, signal) => {
            await runAbstractGeneration(jobId, book.id, signal);
            if (!signal.aborted && bookSeriesId) {
              void runSeriesAbstractGeneration(bookSeriesId, new AbortController().signal);
            }
          });
          createdJobs.push(job);
        } else if (wantEmbed) {
          const job = createBookBackgroundJobIfIdle('embedding_generation', book.id);
          if (!job) return reply.code(409).send(BOOK_JOB_CONFLICT_BODY);
          enqueue(job.id, async (jobId, signal) => {
            await runEmbeddingGeneration(jobId, book.id, signal);
            if (!signal.aborted) await runAbstractEmbeddingGeneration(book.id, signal);
          });
          createdJobs.push(job);
        }
        return reply.code(201).send({ book, jobs: createdJobs });
      } catch (err) {
        return reply
          .code(500)
          .send(apiErr('internal', err instanceof Error ? err.message : 'Ingest failed'));
      }
    },
  );

  fastify.get('/api/books', async () => listBooks());

  fastify.get<{ Params: { id: string } }>(
    '/api/books/:id/abstracts',
    { schema: { params: schemas.idParam } },
    async (req) => {
      return getAbstracts(req.params.id);
    },
  );

  /**
   * POST /api/books/:id/jobs
   * Re-enqueue abstract_generation or embedding_generation for an existing book.
   * Clears existing data before re-running to avoid duplicates.
   */
  fastify.post<{ Params: { id: string }; Body: BookEnqueueJobBody }>(
    '/api/books/:id/jobs',
    { schema: { params: schemas.idParam, body: schemas.bookJobBody } },
    async (req, reply) => {
      const book = getBook(req.params.id);
      if (!book) return reply.code(404).send(apiErr('not_found', 'Book not found'));

      const body = req.body;
      const { type } = body;
      const chainAbstractGeneration =
        type === 'embedding_generation' && body.chainAbstractGeneration === true;

      if (type === 'abstract_generation') {
        const blocked = abstractEmbeddingProfileBlockedReason(book.id);
        if (blocked) return reply.code(422).send(apiErr('unprocessable', blocked));
        const job = createBookBackgroundJobIfIdle('abstract_generation', book.id);
        if (!job) return reply.code(409).send(BOOK_JOB_CONFLICT_BODY);
        clearAbstracts(book.id);
        const seriesId = book.seriesId;
        enqueue(job.id, async (jobId, signal) => {
          await runAbstractGeneration(jobId, book.id, signal);
          if (!signal.aborted && seriesId) {
            void runSeriesAbstractGeneration(seriesId, new AbortController().signal);
          }
        });
        return reply.code(201).send({ job });
      }

      if (type === 'embedding_generation') {
        const job = createBookBackgroundJobIfIdle('embedding_generation', book.id, {
          chainAbstractGeneration: chainAbstractGeneration,
        });
        if (!job) return reply.code(409).send(BOOK_JOB_CONFLICT_BODY);
        deleteBookEmbeddings(book.id);
        deleteBookAbstractEmbeddings(book.id);
        const seriesId = book.seriesId;
        enqueue(job.id, async (jobId, signal) => {
          await runEmbeddingGeneration(jobId, book.id, signal);
          if (signal.aborted) return;
          if (chainAbstractGeneration) {
            clearAbstracts(book.id);
            await runAbstractGeneration(jobId, book.id, signal);
            if (!signal.aborted && seriesId) {
              void runSeriesAbstractGeneration(seriesId, new AbortController().signal);
            }
          } else {
            await runAbstractEmbeddingGeneration(book.id, signal);
          }
        });
        return reply.code(201).send({ job });
      }

      return reply
        .code(400)
        .send(apiErr('validation', 'type must be abstract_generation or embedding_generation'));
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/books/:id',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      deleteBook(req.params.id);
      return reply.code(204).send();
    },
  );

  fastify.patch<{ Params: { id: string }; Body: { override: boolean } }>(
    '/api/books/:id/embedding-override',
    { schema: { params: schemas.idParam, body: schemas.bookEmbeddingOverrideBody } },
    async (req, reply) => {
      const book = getBook(req.params.id);
      if (!book) return reply.code(404).send(apiErr('not_found', 'Book not found'));
      setBookEmbeddingOverride(req.params.id, Boolean(req.body?.override));
      return reply.code(204).send();
    },
  );

  /**
   * POST /api/books/:id/embeddings/search
   * Embed a query string using the configured model and return the top-N most
   * similar chunks for inspection.
   */
  fastify.post<{ Params: { id: string }; Body: { query: string; n?: number } }>(
    '/api/books/:id/embeddings/search',
    { schema: { params: schemas.idParam, body: schemas.bookEmbeddingSearchBody } },
    async (req, reply) => {
      const book = getBook(req.params.id);
      if (!book) return reply.code(404).send(apiErr('not_found', 'Book not found'));

      const { query, n = 10 } = req.body ?? {};
      if (!query?.trim()) return reply.code(400).send(apiErr('validation', 'query required'));

      const cfg = getLlmConfig();
      const adapter = getAdapter(cfg, getApiKeyPlaintext());
      if (!adapter.embed) {
        return reply
          .code(422)
          .send(apiErr('unprocessable', `${cfg.provider} does not support embeddings`));
      }

      const embeddingModel = getEmbeddingModel();
      if (!embeddingModel)
        return reply.code(422).send(apiErr('unprocessable', 'No embedding model configured'));

      const qPrefix = getEmbeddingQueryPrefix();
      const vectors = await adapter.embed([withEmbeddingQueryPrefix(query.trim(), qPrefix)], embeddingModel);
      const queryVector = vectors[0];
      if (!queryVector)
        return reply.code(422).send(apiErr('unprocessable', 'Embedding returned no vector'));

      const limit = Math.min(n, 50);
      const chunkHits = searchBookEmbeddings(req.params.id, queryVector, limit).map((r) => ({
        ...r,
        source: 'chunk' as const,
      }));
      const abstractHits = searchBookAbstractEmbeddings(req.params.id, queryVector, limit).map((r) => ({
        chunkId: r.chunkId,
        score: r.score,
        text: r.text,
        chapterNumber: r.chapterNumber,
        chapterTitle: r.chapterTitle,
        source: 'abstract' as const,
        abstractLevel: r.level as 'chapter_detailed' | 'chapter_short' | 'book',
      }));

      const results = [...chunkHits, ...abstractHits]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return { results };
    },
  );
}
