import { randomUUID } from 'crypto';
import { Chat, ChatMessage, ChatRole, TitleStatus } from '@shared/types';
import { getDb } from './database';
import { listToolCallsForChatAsc } from './llm-call-log';
import { toolLabelFromLlmToolCallRow } from './chat-tool-labels';

interface ChatRow {
  id: string;
  title: string;
  title_status: TitleStatus;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: ChatRole;
  content: string;
  llm_call_id: string | null;
  chunks_referenced: string | null;
  created_at: string;
}

function chatFromRow(r: ChatRow): Chat {
  return {
    id: r.id,
    title: r.title,
    titleStatus: r.title_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function messageFromRow(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    chatId: r.chat_id,
    role: r.role,
    content: r.content,
    llmCallId: r.llm_call_id,
    chunksReferenced: r.chunks_referenced ? (JSON.parse(r.chunks_referenced) as string[]) : [],
    createdAt: r.created_at,
  };
}

function now(): string {
  return new Date().toISOString();
}

export function createChat(): Chat {
  const id = randomUUID();
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO chats (id, title, title_status, created_at, updated_at)
       VALUES (?, 'Unknown', 'pending', ?, ?)`,
    )
    .run(id, timestamp, timestamp);
  return {
    id,
    title: 'Unknown',
    titleStatus: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function listChats(): Chat[] {
  const rows = getDb()
    .prepare(`SELECT * FROM chats ORDER BY updated_at DESC`)
    .all() as ChatRow[];
  return rows.map(chatFromRow);
}

export function getChat(id: string): Chat | null {
  const row = getDb().prepare(`SELECT * FROM chats WHERE id = ?`).get(id) as
    | ChatRow
    | undefined;
  return row ? chatFromRow(row) : null;
}

export function deleteChat(id: string): void {
  getDb().prepare(`DELETE FROM chats WHERE id = ?`).run(id);
}

export function setChatTitle(id: string, title: string, status: TitleStatus): void {
  getDb()
    .prepare(`UPDATE chats SET title = ?, title_status = ?, updated_at = ? WHERE id = ?`)
    .run(title, status, now(), id);
}

export function addMessage(
  chatId: string,
  role: ChatRole,
  content: string,
  llmCallId: string | null = null,
  chunksReferenced: string[] = [],
): ChatMessage {
  const id = randomUUID();
  const timestamp = now();
  const db = getDb();
  const chunksJson = chunksReferenced.length > 0 ? JSON.stringify(chunksReferenced) : null;
  db.prepare(
    `INSERT INTO chat_messages (id, chat_id, role, content, llm_call_id, chunks_referenced, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, chatId, role, content, llmCallId, chunksJson, timestamp);
  db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(timestamp, chatId);
  return { id, chatId, role, content, llmCallId, chunksReferenced, createdAt: timestamp };
}

export function getMessages(chatId: string): ChatMessage[] {
  const rows = getDb()
    .prepare(`SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC`)
    .all(chatId) as MessageRow[];
  return rows.map(messageFromRow);
}

export function deleteMessagesFrom(chatId: string, messageId: string): void {
  const db = getDb();
  const target = db
    .prepare(`SELECT created_at FROM chat_messages WHERE id = ? AND chat_id = ?`)
    .get(messageId, chatId) as { created_at: string } | undefined;
  if (!target) return;
  db.prepare(`DELETE FROM chat_messages WHERE chat_id = ? AND created_at >= ?`).run(
    chatId,
    target.created_at,
  );
  db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(now(), chatId);
}

/**
 * Maps assistant message id → tool UI labels for that turn (from persisted `tool_call` llm rows).
 * Pass pre-loaded `messages` to avoid a second DB query when the caller already has them.
 *
 * Tool calls are correlated to turns by timestamp: tool rows with createdAt between the
 * preceding message's timestamp (exclusive) and the assistant message's timestamp (exclusive)
 * belong to that assistant turn. `ti` is a forward-only pointer into the sorted toolRows array
 * so the overall scan is O(messages + toolRows).
 */
export function getMessageToolEventLabels(
  chatId: string,
  messages?: ChatMessage[],
): Record<string, string[]> {
  const msgs = messages ?? getMessages(chatId);
  const toolRows = listToolCallsForChatAsc(chatId);
  const out: Record<string, string[]> = {};
  let ti = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    if (m.role !== 'assistant') continue;
    const prev = msgs[i - 1];
    if (!prev) continue;
    const lower = prev.createdAt;
    const upper = m.createdAt;
    // Advance past tool rows that preceded the previous message (already attributed).
    while (ti < toolRows.length && toolRows[ti]!.createdAt <= lower) ti++;
    // Collect tool rows within this turn's window.
    const labels: string[] = [];
    let scan = ti;
    while (scan < toolRows.length && toolRows[scan]!.createdAt < upper) {
      labels.push(toolLabelFromLlmToolCallRow(toolRows[scan]!));
      scan++;
    }
    ti = scan;
    if (labels.length > 0) out[m.id] = labels;
  }
  return out;
}
