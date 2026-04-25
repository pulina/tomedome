import { statSync } from 'fs';
import { app } from 'electron';
import { join } from 'path';
import { getDb } from './database';
import type { CostPrices, LlmStatRow, StatsOverview } from '../../shared/types';

type LlmStatsScope = 'purpose' | 'model';

interface LlmStatAggRow {
  key: string;
  subKey: string;
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  latencySum: number;
  latencyCount: number;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
}

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

  const byPurposeAgg = mergeLlmStatAggRows([
    ...readCurrentLlmStatAgg(db, 'purpose'),
    ...readArchivedLlmStatAgg(db, 'purpose'),
  ]);
  const byModelAgg = mergeLlmStatAggRows([
    ...readCurrentLlmStatAgg(db, 'model'),
    ...readArchivedLlmStatAgg(db, 'model'),
  ]);

  const byPurpose = toLlmStatRows(byPurposeAgg);
  const byModel = toLlmStatRows(byModelAgg);
  const llmCallsTotal = byPurpose.reduce((sum, r) => sum + r.calls, 0);
  const llmCallsError = byPurpose.reduce((sum, r) => sum + r.errors, 0);

  const overview: StatsOverview = {
    chats: n('SELECT COUNT(*) as n FROM chats'),
    messagesUser: n("SELECT COUNT(*) as n FROM chat_messages WHERE role='user'"),
    messagesAssistant: n("SELECT COUNT(*) as n FROM chat_messages WHERE role='assistant'"),
    llmCallsTotal,
    llmCallsError,
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

  return { overview, byPurpose, byModel };
}

function readCurrentLlmStatAgg(db: ReturnType<typeof getDb>, scope: LlmStatsScope): LlmStatAggRow[] {
  if (scope === 'purpose') {
    return db
      .prepare(`
        SELECT
          purpose                                                      AS key,
          ''                                                           AS subKey,
          COUNT(*)                                                     AS calls,
          SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)          AS errors,
          COALESCE(SUM(prompt_tokens), 0)                              AS promptTokens,
          COALESCE(SUM(completion_tokens), 0)                          AS completionTokens,
          COALESCE(SUM(CASE WHEN latency_ms IS NOT NULL THEN latency_ms ELSE 0 END), 0) AS latencySum,
          SUM(CASE WHEN latency_ms IS NOT NULL THEN 1 ELSE 0 END)      AS latencyCount,
          MIN(latency_ms)                                              AS minLatencyMs,
          MAX(latency_ms)                                              AS maxLatencyMs
        FROM llm_calls
        GROUP BY purpose
      `)
      .all() as LlmStatAggRow[];
  }
  return db
    .prepare(`
      SELECT
        COALESCE(model, 'unknown')                                     AS key,
        COALESCE(provider, 'unknown')                                  AS subKey,
        COUNT(*)                                                       AS calls,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)            AS errors,
        COALESCE(SUM(prompt_tokens), 0)                                AS promptTokens,
        COALESCE(SUM(completion_tokens), 0)                            AS completionTokens,
        COALESCE(SUM(CASE WHEN latency_ms IS NOT NULL THEN latency_ms ELSE 0 END), 0) AS latencySum,
        SUM(CASE WHEN latency_ms IS NOT NULL THEN 1 ELSE 0 END)        AS latencyCount,
        MIN(latency_ms)                                                AS minLatencyMs,
        MAX(latency_ms)                                                AS maxLatencyMs
      FROM llm_calls
      GROUP BY model, provider
    `)
    .all() as LlmStatAggRow[];
}

function readArchivedLlmStatAgg(db: ReturnType<typeof getDb>, scope: LlmStatsScope): LlmStatAggRow[] {
  return db
    .prepare(`
      SELECT
        key,
        sub_key        AS subKey,
        calls,
        errors,
        prompt_tokens  AS promptTokens,
        completion_tokens AS completionTokens,
        latency_sum    AS latencySum,
        latency_count  AS latencyCount,
        min_latency_ms AS minLatencyMs,
        max_latency_ms AS maxLatencyMs
      FROM llm_stats_archive
      WHERE scope = ?
    `)
    .all(scope) as LlmStatAggRow[];
}

function mergeLlmStatAggRows(rows: LlmStatAggRow[]): Map<string, LlmStatAggRow> {
  const out = new Map<string, LlmStatAggRow>();
  for (const r of rows) {
    const id = `${r.key}\u0000${r.subKey}`;
    const prev = out.get(id);
    if (!prev) {
      out.set(id, { ...r });
      continue;
    }
    prev.calls += r.calls;
    prev.errors += r.errors;
    prev.promptTokens += r.promptTokens;
    prev.completionTokens += r.completionTokens;
    prev.latencySum += r.latencySum;
    prev.latencyCount += r.latencyCount;
    prev.minLatencyMs =
      prev.minLatencyMs == null
        ? r.minLatencyMs
        : r.minLatencyMs == null
          ? prev.minLatencyMs
          : Math.min(prev.minLatencyMs, r.minLatencyMs);
    prev.maxLatencyMs =
      prev.maxLatencyMs == null
        ? r.maxLatencyMs
        : r.maxLatencyMs == null
          ? prev.maxLatencyMs
          : Math.max(prev.maxLatencyMs, r.maxLatencyMs);
  }
  return out;
}

function toLlmStatRows(m: Map<string, LlmStatAggRow>): LlmStatRow[] {
  const rows = [...m.values()].map((r) => ({
    key: r.key,
    subKey: r.subKey === '' ? null : r.subKey,
    calls: r.calls,
    errors: r.errors,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    avgLatencyMs: r.latencyCount > 0 ? Math.round(r.latencySum / r.latencyCount) : null,
    minLatencyMs: r.minLatencyMs,
    maxLatencyMs: r.maxLatencyMs,
  }));
  rows.sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key) || (a.subKey ?? '').localeCompare(b.subKey ?? ''));
  return rows;
}

export function archiveAndClearLlmCallsForStats(): void {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO llm_stats_archive (
      scope, key, sub_key, calls, errors, prompt_tokens, completion_tokens,
      latency_sum, latency_count, min_latency_ms, max_latency_ms, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(scope, key, sub_key) DO UPDATE SET
      calls = llm_stats_archive.calls + excluded.calls,
      errors = llm_stats_archive.errors + excluded.errors,
      prompt_tokens = llm_stats_archive.prompt_tokens + excluded.prompt_tokens,
      completion_tokens = llm_stats_archive.completion_tokens + excluded.completion_tokens,
      latency_sum = llm_stats_archive.latency_sum + excluded.latency_sum,
      latency_count = llm_stats_archive.latency_count + excluded.latency_count,
      min_latency_ms = CASE
        WHEN llm_stats_archive.min_latency_ms IS NULL THEN excluded.min_latency_ms
        WHEN excluded.min_latency_ms IS NULL THEN llm_stats_archive.min_latency_ms
        ELSE MIN(llm_stats_archive.min_latency_ms, excluded.min_latency_ms)
      END,
      max_latency_ms = CASE
        WHEN llm_stats_archive.max_latency_ms IS NULL THEN excluded.max_latency_ms
        WHEN excluded.max_latency_ms IS NULL THEN llm_stats_archive.max_latency_ms
        ELSE MAX(llm_stats_archive.max_latency_ms, excluded.max_latency_ms)
      END,
      updated_at = datetime('now')
  `);
  db.transaction(() => {
    const purposeRows = readCurrentLlmStatAgg(db, 'purpose');
    const modelRows = readCurrentLlmStatAgg(db, 'model');
    for (const r of purposeRows) {
      upsert.run(
        'purpose',
        r.key,
        r.subKey,
        r.calls,
        r.errors,
        r.promptTokens,
        r.completionTokens,
        r.latencySum,
        r.latencyCount,
        r.minLatencyMs,
        r.maxLatencyMs,
      );
    }
    for (const r of modelRows) {
      upsert.run(
        'model',
        r.key,
        r.subKey,
        r.calls,
        r.errors,
        r.promptTokens,
        r.completionTokens,
        r.latencySum,
        r.latencyCount,
        r.minLatencyMs,
        r.maxLatencyMs,
      );
    }
    db.prepare('DELETE FROM llm_calls').run();
  })();
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
