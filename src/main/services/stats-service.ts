import { statSync } from 'fs';
import { app } from 'electron';
import { join } from 'path';
import { getDb } from './database';
import type { CostPrices, LlmStatRow, StatsOverview } from '../../shared/types';

function safeFileBytes(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function getStatsPayload(): {
  overview: StatsOverview;
  byPurpose: LlmStatRow[];
  byModel: LlmStatRow[];
} {
  const db = getDb();
  const userData = app.getPath('userData');

  const n = (stmt: string) => (db.prepare(stmt).get() as { n: number }).n;

  const overview: StatsOverview = {
    chats: n('SELECT COUNT(*) as n FROM chats'),
    messagesUser: n("SELECT COUNT(*) as n FROM chat_messages WHERE role='user'"),
    messagesAssistant: n("SELECT COUNT(*) as n FROM chat_messages WHERE role='assistant'"),
    llmCallsTotal: n('SELECT COUNT(*) as n FROM llm_calls'),
    llmCallsError: n("SELECT COUNT(*) as n FROM llm_calls WHERE error IS NOT NULL"),
    series: n('SELECT COUNT(*) as n FROM series'),
    books: n('SELECT COUNT(*) as n FROM books'),
    chunks: n('SELECT COUNT(*) as n FROM chunks'),
    abstracts: n('SELECT COUNT(*) as n FROM abstracts'),
    totalWords: n('SELECT COALESCE(SUM(word_count), 0) as n FROM books'),
    dbSizeBytes: safeFileBytes(join(userData, 'tomedome.db')),
    ragSizeBytes:
      n('SELECT COALESCE(SUM(length(vector)), 0) as n FROM chunk_embeddings') +
      n('SELECT COALESCE(SUM(length(vector)), 0) as n FROM abstract_embeddings'),
    logSizeBytes: safeFileBytes(join(userData, 'logs', 'tomedome.log')),
  };

  const byPurpose = db
    .prepare(`
      SELECT
        purpose                                                   AS key,
        NULL                                                      AS subKey,
        COUNT(*)                                                  AS calls,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)        AS errors,
        COALESCE(SUM(prompt_tokens), 0)                           AS promptTokens,
        COALESCE(SUM(completion_tokens), 0)                       AS completionTokens,
        CAST(AVG(latency_ms) AS INTEGER)                          AS avgLatencyMs,
        MIN(latency_ms)                                           AS minLatencyMs,
        MAX(latency_ms)                                           AS maxLatencyMs
      FROM llm_calls
      GROUP BY purpose
      ORDER BY calls DESC
    `)
    .all() as LlmStatRow[];

  const byModel = db
    .prepare(`
      SELECT
        COALESCE(model, 'unknown')                                AS key,
        COALESCE(provider, 'unknown')                             AS subKey,
        COUNT(*)                                                  AS calls,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)        AS errors,
        COALESCE(SUM(prompt_tokens), 0)                           AS promptTokens,
        COALESCE(SUM(completion_tokens), 0)                       AS completionTokens,
        CAST(AVG(latency_ms) AS INTEGER)                          AS avgLatencyMs,
        MIN(latency_ms)                                           AS minLatencyMs,
        MAX(latency_ms)                                           AS maxLatencyMs
      FROM llm_calls
      GROUP BY model, provider
      ORDER BY calls DESC
    `)
    .all() as LlmStatRow[];

  return { overview, byPurpose, byModel };
}

export function getCostPricesFromDb(): CostPrices {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM config WHERE key LIKE 'cost_price.%'")
    .all() as { key: string; value: string }[];

  const prices: CostPrices = {};
  for (const { key, value } of rows) {
    const dot = key.indexOf('.', 'cost_price.'.length);
    if (dot === -1) continue;
    const model = key.slice('cost_price.'.length, dot);
    const type = key.slice(dot + 1) as 'input' | 'output';
    if (!prices[model]) prices[model] = { input: 0, output: 0 };
    prices[model][type] = parseFloat(value) || 0;
  }
  return prices;
}

export function saveCostPrices(prices: CostPrices): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  );
  db.transaction((p: CostPrices) => {
    for (const [model, { input, output }] of Object.entries(p)) {
      stmt.run(`cost_price.${model}.input`, String(input));
      stmt.run(`cost_price.${model}.output`, String(output));
    }
  })(prices);
}
