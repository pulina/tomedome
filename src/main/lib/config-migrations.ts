import type Database from 'better-sqlite3';
import { CONFIG_KEY } from './config-keys';

/** Increment when adding a new `migrateConfigKvV*` step; keep in sync with runConfigKeyMigrations. */
export const CURRENT_CONFIG_KV_VERSION = 1;

/**
 * Migrates `config` row keys between app versions. Runs after tables exist.
 * Add `if (v < N) { ... }` blocks when renaming keys; never rename without a step here.
 */
export function runConfigKeyMigrations(db: Database.Database): void {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(CONFIG_KEY.configKvVersion) as
    | { value: string }
    | undefined;
  let v = row?.value ? parseInt(row.value, 10) : 0;
  if (!Number.isFinite(v) || v < 0) v = 0;

  if (v >= CURRENT_CONFIG_KV_VERSION) return;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(CONFIG_KEY.configKvVersion, String(CURRENT_CONFIG_KV_VERSION));
  })();
}
