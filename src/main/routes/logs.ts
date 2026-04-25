import { FastifyInstance } from 'fastify';
import { apiErr } from '../lib/api-errors';
import { LogLevel, LLM_CALL_PURPOSES, type LlmCallPurpose } from '@shared/types';
import { clearLogs, readAppLog } from '../services/log-reader';
import { getLlmCall, listLlmCalls } from '../services/llm-call-log';
import { clearAllData } from '../services/database';
import { MAX_LOG_LIMIT, schemas } from './schemas';

const VALID_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

function clampLogLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(Math.floor(n), MAX_LOG_LIMIT);
}

export async function registerLogRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { level?: string; levels?: string; limit?: string } }>(
    '/api/logs/app',
    { schema: { querystring: schemas.logsAppQuery } },
    async (req) => {
      const limit = clampLogLimit(req.query.limit);
      const rawLevels = req.query.levels;
      if (rawLevels !== undefined) {
        const parts = rawLevels
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const levels = parts.filter((p): p is LogLevel =>
          VALID_LEVELS.includes(p as LogLevel),
        );
        return readAppLog({ levels, limit });
      }
      const rawLevel = req.query.level;
      const level = VALID_LEVELS.includes(rawLevel as LogLevel)
        ? (rawLevel as LogLevel)
        : undefined;
      return readAppLog({ level, limit });
    },
  );

  fastify.get<{ Querystring: { limit?: string; chatId?: string; purposes?: string } }>(
    '/api/logs/llm',
    { schema: { querystring: schemas.logsLlmQuery } },
    async (req) => {
      const limit = clampLogLimit(req.query.limit);
      const allow = new Set<string>(LLM_CALL_PURPOSES);
      const purposesProvided = req.query.purposes !== undefined;
      const purposesRaw = req.query.purposes?.trim();
      const purposes =
        purposesRaw && purposesRaw.length > 0
          ? (purposesRaw
              .split(',')
              .map((s) => s.trim())
              .filter((s): s is LlmCallPurpose => allow.has(s)) as LlmCallPurpose[])
          : purposesProvided
            ? []
            : undefined;
      return listLlmCalls({ chatId: req.query.chatId, limit, purposes });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/logs/llm/:id',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      const call = getLlmCall(req.params.id);
      if (!call) return reply.code(404).send(apiErr('not_found', 'not found'));
      return call;
    },
  );

  fastify.delete('/api/logs', async (_req, reply) => {
    await clearLogs();
    return reply.code(204).send();
  });

  fastify.delete('/api/data/reset', async (_req, reply) => {
    clearAllData();
    await clearLogs();
    return reply.code(204).send();
  });
}
