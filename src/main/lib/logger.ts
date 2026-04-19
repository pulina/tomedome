import pino from 'pino';
import { app } from 'electron';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { LlmProvider } from '@shared/types';

const llmApiKeyPaths = Object.values(LlmProvider).map((p) => `llm_api_key_${p}`);

/** Shared with Fastify so HTTP logs redact the same fields as the main-process logger. */
export const PINO_REDACT_PATHS: string[] = [
  'apiKey',
  '*.apiKey',
  '*.api_key',
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'llm_api_key',
  ...llmApiKeyPaths,
];

function buildLogger() {
  const userData = app.getPath('userData');
  const logDir = join(userData, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, 'tomedome.log');

  const isDev = !app.isPackaged;

  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino/file',
      level: 'info',
      options: { destination: logFile, mkdir: true },
    },
  ];

  if (isDev) {
    targets.push({
      target: 'pino-pretty',
      level: 'debug',
      options: { colorize: true, translateTime: 'SYS:standard' },
    });
  }

  return pino(
    {
      level: isDev ? 'debug' : 'info',
      base: { app: 'tomedome' },
      redact: {
        paths: PINO_REDACT_PATHS,
        censor: '[Redacted]',
      },
    },
    pino.transport({ targets }),
  );
}

let _logger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (!_logger) _logger = buildLogger();
  return _logger;
}
