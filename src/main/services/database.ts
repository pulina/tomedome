import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { LlmProvider } from '@shared/types';
import { CONFIG_KEY, llmApiKeyStorageKey } from '../lib/config-keys';
import { runConfigKeyMigrations } from '../lib/config-migrations';
import { getLogger } from '../lib/logger';

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (_db) return _db;

  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const dbPath = join(userData, 'tomedome.db');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Unknown',
      title_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      llm_call_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON chat_messages(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS llm_calls (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      purpose TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      request_json TEXT NOT NULL,
      response_text TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      latency_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_chat ON llm_calls(chat_id);

    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      author TEXT,
      year INTEGER,
      genre TEXT,
      file_path TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      ingested_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_number INTEGER,
      chapter_title TEXT,
      paragraph_index INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      token_count INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id, paragraph_index);
    CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(book_id, chapter_number);
    CREATE INDEX IF NOT EXISTS idx_books_series ON books(series_id);

    CREATE TABLE IF NOT EXISTS abstracts (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_number INTEGER,
      level TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_abstracts_book ON abstracts(book_id, level);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      progress_label TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id   TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
      vector     TEXT    NOT NULL,
      model      TEXT    NOT NULL,
      dim        INTEGER NOT NULL,
      created_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS abstract_embeddings (
      abstract_id TEXT PRIMARY KEY REFERENCES abstracts(id) ON DELETE CASCADE,
      vector      TEXT    NOT NULL,
      model       TEXT    NOT NULL,
      dim         INTEGER NOT NULL,
      created_at  TEXT    NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      raw_text,
      content=chunks,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, raw_text) VALUES (new.rowid, new.raw_text);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_fts_delete BEFORE DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, raw_text) VALUES ('delete', old.rowid, old.raw_text);
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, raw_text) VALUES ('delete', old.rowid, old.raw_text);
      INSERT INTO chunks_fts(rowid, raw_text) VALUES (new.rowid, new.raw_text);
    END;
  `);

  // Migrations for existing databases
  try { db.exec(`ALTER TABLE books ADD COLUMN series_id TEXT REFERENCES series(id) ON DELETE SET NULL`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE books ADD COLUMN embedded_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE books ADD COLUMN abstracted_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE books ADD COLUMN language TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE abstracts ADD COLUMN chapter_title TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE jobs ADD COLUMN model TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE jobs ADD COLUMN started_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE series ADD COLUMN abstract TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE series ADD COLUMN abstracted_at TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE chat_messages ADD COLUMN chunks_referenced TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE books ADD COLUMN embedding_model TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE books ADD COLUMN embedding_model_override INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
  // Backfill FTS index for any chunks inserted before the virtual table existed.
  try { db.exec(`INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')`); } catch { /* non-critical */ }

  // Migrate single global llm_api_key → per-provider keys (llm_api_key_<provider>).
  // We don't know which provider the key belonged to, so copy it to all providers
  // that require a key. INSERT OR IGNORE means already-migrated rows are left untouched.
  try {
    const legacyKey = db.prepare('SELECT value FROM config WHERE key = ?').get(CONFIG_KEY.legacyLlmApiKey) as
      | { value: string }
      | undefined;
    if (legacyKey?.value) {
      const stmt = db.prepare(`INSERT OR IGNORE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
      for (const p of [LlmProvider.Anthropic, LlmProvider.OpenAI, LlmProvider.OpenRouter]) {
        stmt.run(llmApiKeyStorageKey(p), legacyKey.value);
      }
    }
  } catch { /* non-critical — new installs have no legacy key */ }

  try {
    db.exec(`
      UPDATE jobs
      SET status = 'error',
          error = 'Job interrupted by app crash',
          updated_at = datetime('now')
      WHERE status IN ('running', 'pending')
    `);
  } catch {
    /* non-critical */
  }

  // Garbage-collect empty chats from previous sessions (no messages).
  db.exec(`
    DELETE FROM chats WHERE id NOT IN (SELECT DISTINCT chat_id FROM chat_messages);
  `);

  // Schema version — bump when structural migrations are added
  db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)').run(CONFIG_KEY.schemaVersion, '2');
  db.prepare('UPDATE config SET value=? WHERE key=? AND CAST(value AS INTEGER) < 2').run(
    '2',
    CONFIG_KEY.schemaVersion,
  );

  runConfigKeyMigrations(db);

  getLogger().info({ dbPath }, 'SQLite database initialised');
  _db = db;
  return db;
}

/**
 * Delete all user data including config (except schema_version).
 * Runs in a single transaction. Order respects FK constraints:
 * chats → chat_messages (CASCADE), books → chunks/abstracts/embeddings (CASCADE).
 */
export function clearAllData(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM llm_calls').run();
    db.prepare('DELETE FROM jobs').run();
    db.prepare('DELETE FROM chats').run();
    db.prepare('DELETE FROM books').run();
    db.prepare('DELETE FROM series').run();
    db.prepare(`DELETE FROM config WHERE key NOT IN (?, ?)`).run(CONFIG_KEY.schemaVersion, CONFIG_KEY.configKvVersion);
  })();
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}

/** Swap the DB singleton for tests; pass `null` to close and clear. */
export function setDbForTesting(db: Database.Database | null): void {
  if (_db && _db !== db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
  }
  _db = db ?? undefined;
}
