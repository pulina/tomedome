import { FastifyInstance } from 'fastify';
import { apiErr } from '../lib/api-errors';
import { reorderBooksInSeries } from '../services/book-service';
import { createSeries, deleteSeries, getSeries, listSeries, renameSeries } from '../services/series-service';
import { runSeriesAbstractGeneration } from '../services/abstract-service';
import { schemas } from './schemas';

export async function registerSeriesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/series', async () => listSeries());

  fastify.post<{ Body: { title: string; description?: string } }>(
    '/api/series',
    { schema: { body: schemas.seriesCreateBody } },
    async (req, reply) => {
      const { title, description } = req.body ?? {};
      if (!title?.trim()) return reply.code(400).send(apiErr('validation', 'title required'));
      return reply.code(201).send(createSeries(title.trim(), description?.trim()));
    },
  );

  fastify.patch<{ Params: { id: string }; Body: { title: string } }>(
    '/api/series/:id',
    { schema: { params: schemas.idParam, body: schemas.seriesRenameBody } },
    async (req, reply) => {
      const updated = renameSeries(req.params.id, req.body.title.trim());
      if (!updated) return reply.code(404).send(apiErr('not_found', 'not found'));
      return updated;
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/series/:id',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      deleteSeries(req.params.id);
      return reply.code(204).send();
    },
  );

  fastify.put<{ Params: { id: string }; Body: { bookIds: string[] } }>(
    '/api/series/:id/books/order',
    { schema: { params: schemas.idParam, body: schemas.seriesBookOrderBody } },
    async (req, reply) => {
      if (!getSeries(req.params.id)) return reply.code(404).send(apiErr('not_found', 'Series not found'));
      try {
        reorderBooksInSeries(req.params.id, req.body.bookIds);
      } catch (e) {
        return reply
          .code(400)
          .send(apiErr('validation', e instanceof Error ? e.message : 'Invalid book order'));
      }
      return reply.code(204).send();
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/series/:id/abstract',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      const series = getSeries(req.params.id);
      if (!series) return reply.code(404).send(apiErr('not_found', 'not found'));
      return { abstract: series.abstract ?? null, abstractedAt: series.abstractedAt ?? null };
    },
  );

  /**
   * POST /api/series/:id/abstract/regenerate
   * Regenerates the series abstract from all current book-level abstracts.
   * Synchronous — waits for the LLM call to complete before responding.
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/series/:id/abstract/regenerate',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      const series = getSeries(req.params.id);
      if (!series) return reply.code(404).send(apiErr('not_found', 'not found'));

      const abort = new AbortController();
      reply.raw.on('close', () => abort.abort());

      await runSeriesAbstractGeneration(series.id, abort.signal);

      const updated = getSeries(series.id);
      return { abstract: updated?.abstract ?? null, abstractedAt: updated?.abstractedAt ?? null };
    },
  );
}
