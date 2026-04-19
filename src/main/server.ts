import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { getLogger, PINO_REDACT_PATHS } from './lib/logger';
import { apiErr } from './lib/api-errors';
import { registerHealthRoutes } from './routes/health';
import { registerConfigRoutes } from './routes/config';
import { registerChatRoutes } from './routes/chats';
import { registerLogRoutes } from './routes/logs';
import { registerBookRoutes } from './routes/books';
import { registerJobRoutes } from './routes/jobs';
import { registerSeriesRoutes } from './routes/series';
import { registerStatsRoutes } from './routes/stats';
import { registerExportImportRoutes } from './routes/export-import';

export interface StartedServer {
  fastify: FastifyInstance;
  port: number;
  url: string;
}

export async function startServer(): Promise<StartedServer> {
  const log = getLogger();
  // Fastify uses its own built-in pino logger; our main-process logger stays
  // separate so we can log non-HTTP events (boot, shutdown) consistently.
  const fastify: FastifyInstance = Fastify({
    logger: {
      level: 'info',
      redact: { paths: PINO_REDACT_PATHS, censor: '[Redacted]' },
    },
  });

  fastify.setErrorHandler(async (error, request, reply) => {
    log.error({ err: error, url: request.url }, 'Unhandled route error');
    if (reply.sent) return;
    return reply.code(500).send(apiErr('internal', 'Internal server error'));
  });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (origin === undefined) {
        cb(null, true);
        return;
      }
      try {
        const u = new URL(origin);
        const loopback =
          u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
        const http = u.protocol === 'http:' || u.protocol === 'https:';
        cb(null, loopback && http);
      } catch {
        cb(null, false);
      }
    },
    exposedHeaders: ['content-disposition'],
  });
  await registerHealthRoutes(fastify);
  await registerConfigRoutes(fastify);
  await registerChatRoutes(fastify);
  await registerLogRoutes(fastify);
  await registerSeriesRoutes(fastify);
  await registerBookRoutes(fastify);
  await registerJobRoutes(fastify);
  await registerStatsRoutes(fastify);
  await registerExportImportRoutes(fastify);

  const address = await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  log.info({ address, port }, 'Fastify backend listening');

  return { fastify, port, url: `http://127.0.0.1:${port}` };
}
