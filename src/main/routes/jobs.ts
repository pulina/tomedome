import { FastifyInstance } from 'fastify';
import { apiErr } from '../lib/api-errors';
import { cancelJob, clearFinishedJobs, jobEmitter, listJobs } from '../services/job-queue';
import type { Job } from '../../shared/types';
import { schemas } from './schemas';

export async function registerJobRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/jobs', async () => listJobs());

  fastify.delete<{ Params: { id: string } }>(
    '/api/jobs/:id',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      const ok = cancelJob(req.params.id);
      if (!ok) return reply.code(404).send(apiErr('not_found', 'job not found'));
      return reply.code(204).send();
    },
  );

  fastify.delete('/api/jobs', async (_req, reply) => {
    clearFinishedJobs();
    return reply.code(204).send();
  });

  fastify.get('/api/jobs/stream', async (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (job: Job) => raw.write(`data: ${JSON.stringify(job)}\n\n`);
    for (const job of listJobs()) send(job);
    jobEmitter.on('update', send);
    req.raw.on('close', () => jobEmitter.off('update', send));
  });
}
