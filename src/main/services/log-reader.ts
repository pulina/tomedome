import { app } from 'electron';
import { createReadStream, promises as fs } from 'fs';
import { join } from 'path';
import { getDb } from './database';
import { AppLogEntry, LogLevel } from '@shared/types';

const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function logFilePath(): string {
  return join(app.getPath('userData'), 'logs', 'tomedome.log');
}

/** Pino writes numeric levels. Map back to a string. */
function numericToLevel(n: number): LogLevel {
  if (n >= 60) return 'fatal';
  if (n >= 50) return 'error';
  if (n >= 40) return 'warn';
  if (n >= 30) return 'info';
  if (n >= 20) return 'debug';
  return 'trace';
}

/**
 * Reads the tail of the log file, parses JSON lines, returns newest-first.
 * For Epic 1.2 we read up to 512 KB from the end — plenty for hundreds of
 * entries without any paging machinery. If the log file doesn't exist yet,
 * returns an empty array.
 */
export async function readAppLog(opts: {
  level?: LogLevel;
  limit?: number;
} = {}): Promise<AppLogEntry[]> {
  const path = logFilePath();
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(path);
  } catch {
    return [];
  }

  const maxBytes = 512 * 1024;
  const start = Math.max(0, stat.size - maxBytes);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { start });
    stream.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  const text = Buffer.concat(chunks).toString('utf8');

  // The first line might be partial if we seeked mid-line; drop it unless we
  // started at byte 0.
  const lines = text.split('\n');
  const usable = start === 0 ? lines : lines.slice(1);
  const minLevel = LEVEL_VALUES[opts.level ?? 'debug'];
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));

  const entries: AppLogEntry[] = [];
  for (const line of usable) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const numericLevel = typeof obj.level === 'number' ? obj.level : 30;
      if (numericLevel < minLevel) continue;
      entries.push({
        ...obj,
        level: numericToLevel(numericLevel),
        time: typeof obj.time === 'number' ? obj.time : Date.now(),
        msg: typeof obj.msg === 'string' ? obj.msg : '',
      });
    } catch {
      // Not JSON — skip (pino-pretty dev output in the same file would land here).
    }
  }

  entries.reverse(); // newest first
  return entries.slice(0, limit);
}

/** Truncate the app log file and clear all LLM call records from the DB. */
export async function clearLogs(): Promise<void> {
  await fs.writeFile(logFilePath(), '', 'utf8').catch(() => {
    // File may not exist yet — that's fine
  });
  getDb().prepare('DELETE FROM llm_calls').run();
}
