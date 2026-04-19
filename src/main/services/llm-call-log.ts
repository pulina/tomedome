import { randomUUID } from 'crypto';
import { LlmCall, LlmCallPurpose } from '@shared/types';
import { getDb } from './database';

interface LlmCallRow {
  id: string;
  chat_id: string | null;
  purpose: LlmCallPurpose;
  provider: string | null;
  model: string | null;
  request_json: string;
  response_text: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

function rowToCall(r: LlmCallRow): LlmCall {
  return {
    id: r.id,
    chatId: r.chat_id,
    purpose: r.purpose,
    provider: r.provider,
    model: r.model,
    requestJson: r.request_json,
    responseText: r.response_text,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    latencyMs: r.latency_ms,
    error: r.error,
    createdAt: r.created_at,
  };
}

export interface InsertLlmCall {
  chatId: string | null;
  purpose: LlmCallPurpose;
  provider: string;
  model: string;
  requestJson: string;
}

export function insertLlmCall(c: InsertLlmCall): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO llm_calls
       (id, chat_id, purpose, provider, model, request_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, c.chatId, c.purpose, c.provider, c.model, c.requestJson, new Date().toISOString());
  return id;
}

export interface FinaliseLlmCall {
  responseText: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  error: string | null;
}

export function finaliseLlmCall(id: string, u: FinaliseLlmCall): void {
  getDb()
    .prepare(
      `UPDATE llm_calls
       SET response_text = ?, prompt_tokens = ?, completion_tokens = ?, latency_ms = ?, error = ?
       WHERE id = ?`,
    )
    .run(u.responseText, u.promptTokens, u.completionTokens, u.latencyMs, u.error, id);
}

export function getLlmCall(id: string): LlmCall | null {
  const row = getDb().prepare(`SELECT * FROM llm_calls WHERE id = ?`).get(id) as
    | LlmCallRow
    | undefined;
  return row ? rowToCall(row) : null;
}

export interface LlmCallsQuery {
  chatId?: string;
  limit?: number;
}

export function listLlmCalls(q: LlmCallsQuery = {}): LlmCall[] {
  const limit = Math.max(1, Math.min(q.limit ?? 200, 2000));
  if (q.chatId) {
    const rows = getDb()
      .prepare(`SELECT * FROM llm_calls WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(q.chatId, limit) as LlmCallRow[];
    return rows.map(rowToCall);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM llm_calls ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as LlmCallRow[];
  return rows.map(rowToCall);
}
