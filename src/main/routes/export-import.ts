import { FastifyInstance } from 'fastify';
import { apiErr } from '../lib/api-errors';
import { exportSeries, exportBook, importZip, peekZip } from '../services/export-service';
import { getBook } from '../services/book-service';
import { getSeries } from '../services/series-service';
import { schemas } from './schemas';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'export';
}

export async function registerExportImportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string }; Querystring: { embeddings?: string } }>(
    '/api/series/:id/export',
    { schema: { params: schemas.idParam, querystring: schemas.exportQuery } },
    async (req, reply) => {
      const includeEmbeddings = req.query.embeddings === '1' || req.query.embeddings === 'true';
      try {
        const buffer = await exportSeries(req.params.id, includeEmbeddings);
        const series = getSeries(req.params.id);
        const filename = `${slugify(series?.title ?? req.params.id)}_series.zip`;

        return reply
          .code(200)
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(buffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed';
        if (msg === 'Series not found') return reply.code(404).send(apiErr('not_found', msg));
        return reply.code(500).send(apiErr('internal', msg));
      }
    },
  );

  fastify.get<{ Params: { id: string }; Querystring: { embeddings?: string } }>(
    '/api/books/:id/export',
    { schema: { params: schemas.idParam, querystring: schemas.exportQuery } },
    async (req, reply) => {
      const includeEmbeddings = req.query.embeddings === '1' || req.query.embeddings === 'true';
      try {
        const buffer = await exportBook(req.params.id, includeEmbeddings);
        const book = getBook(req.params.id);
        const filename = `${slugify(book?.title ?? req.params.id)}.zip`;
        return reply
          .code(200)
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(buffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Export failed';
        if (msg === 'Book not found') return reply.code(404).send(apiErr('not_found', msg));
        return reply.code(500).send(apiErr('internal', msg));
      }
    },
  );

  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  fastify.post<{ Body: Buffer }>(
    '/api/import/peek',
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return reply.code(400).send(apiErr('validation', 'Request body must be a non-empty zip file'));
      }
      try {
        const result = await peekZip(req.body);
        return reply.send(result);
      } catch (err) {
        return reply
          .code(422)
          .send(apiErr('unprocessable', err instanceof Error ? err.message : 'Peek failed'));
      }
    },
  );

  fastify.post<{ Body: Buffer; Querystring: { seriesId?: string } }>(
    '/api/import',
    { schema: { querystring: schemas.importQuery } },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return reply.code(400).send(apiErr('validation', 'Request body must be a non-empty zip file'));
      }
      try {
        const result = await importZip(req.body, req.query.seriesId);
        return reply.code(201).send(result);
      } catch (err) {
        return reply
          .code(422)
          .send(apiErr('unprocessable', err instanceof Error ? err.message : 'Import failed'));
      }
    },
  );
}
