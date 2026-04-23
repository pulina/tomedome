import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { getDb } from './database';
import type { Job, JobStatus, JobType } from '../../shared/types';
// re-export so routes can use the type directly
export type { Job };

export interface JobRow {
  id: string;
  type: string;
  book_id: string | null;
  status: string;
  progress_current: number;
  progress_total: number;
  progress_label: string;
  error: string | null;
  model: string | null;
  started_at: string | null;
  chain_abstract_generation?: number;
  ingest_abstract_then_embed?: number;
  created_at: string;
  updated_at: string;
}

export type JobRunner = (jobId: string, signal: AbortSignal) => Promise<void>;

// Singleton emitter — routes subscribe to get SSE push updates
export const jobEmitter = new EventEmitter();

// In-memory map of abort controllers for running jobs
const controllers = new Map<string, AbortController>();

/** Limit parallel runners — keeps SQLite writer lock and LLM/embed CPU contention predictable (3 is a conservative default). */
const MAX_CONCURRENT_JOBS = 3;
/** Back-pressure: each pending job holds memory + a row; 50 caps worst-case queue depth if jobs stall. */
const MAX_PENDING_RUNNERS = 50;

const pendingRunners: Array<{ jobId: string; runner: JobRunner }> = [];
let activeJobCount = 0;

function runJob(jobId: string, runner: JobRunner): void {
  const controller = new AbortController();
  controllers.set(jobId, controller);
  activeJobCount++;
  void (async () => {
    updateProgress(jobId, 0, 0, 'Starting…', 'running');
    try {
      await runner(jobId, controller.signal);
      if (!controller.signal.aborted) setJobDone(jobId);
    } catch (err) {
      if (!controller.signal.aborted) {
        setJobError(jobId, err instanceof Error ? err.message : String(err));
      }
    } finally {
      controllers.delete(jobId);
      activeJobCount--;
      pumpQueue();
    }
  })();
}

function pumpQueue(): void {
  while (activeJobCount < MAX_CONCURRENT_JOBS && pendingRunners.length > 0) {
    const next = pendingRunners.shift()!;
    runJob(next.jobId, next.runner);
  }
}

function rowToJob(row: JobRow, bookTitle: string): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    bookId: row.book_id ?? '',
    bookTitle,
    ...(row.chain_abstract_generation === 1 ? { chainAbstractGeneration: true as const } : {}),
    ...(row.ingest_abstract_then_embed === 1 ? { ingestAbstractThenEmbed: true as const } : {}),
    status: row.status as JobStatus,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    progressLabel: row.progress_label,
    error: row.error ?? undefined,
    model: row.model ?? undefined,
    startedAt: row.started_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getBookTitle(bookId: string | null): string {
  if (!bookId) return 'Unknown';
  const row = getDb().prepare('SELECT title FROM books WHERE id = ?').get(bookId) as
    | { title: string }
    | undefined;
  return row?.title ?? 'Unknown';
}

/**
 * At most one pending or running abstract/embedding job per book (avoids concurrent DB writers).
 * Uses BEGIN IMMEDIATE so two concurrent HTTP handlers cannot both pass the existence check.
 */
export interface CreateBookBackgroundJobOpts {
  /** Only for `embedding_generation`: after chunk embed, clear and regenerate abstract text + abstract embeddings. */
  chainAbstractGeneration?: boolean;
  /** Ingest with both abstract + embed: one job runs abstract LLM then chunk + abstract vectors (UI label). */
  ingestAbstractThenEmbed?: boolean;
}

export function createBookBackgroundJobIfIdle(
  type: JobType,
  bookId: string,
  opts?: CreateBookBackgroundJobOpts,
): Job | null {
  const db = getDb();
  const now = new Date().toISOString();
  const chain =
    type === 'embedding_generation' && opts?.chainAbstractGeneration === true ? 1 : 0;
  const ingestAbstractThenEmbed =
    type === 'abstract_generation' && opts?.ingestAbstractThenEmbed === true ? 1 : 0;
  let createdRow: JobRow | undefined;

  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const existing = db
      .prepare(
        `SELECT 1 AS x FROM jobs WHERE book_id = ?
         AND type IN ('abstract_generation', 'embedding_generation')
         AND status IN ('pending', 'running')
         LIMIT 1`,
      )
      .get(bookId) as { x: number } | undefined;
    if (!existing) {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO jobs (id, type, book_id, status, progress_current, progress_total, progress_label, created_at, updated_at, chain_abstract_generation, ingest_abstract_then_embed)
         VALUES (?, ?, ?, 'pending', 0, 0, '', ?, ?, ?, ?)`,
      ).run(id, type, bookId, now, now, chain, ingestAbstractThenEmbed);
      createdRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow;
    }
    db.prepare('COMMIT').run();
  } catch (err) {
    try {
      db.prepare('ROLLBACK').run();
    } catch {
      /* ignore */
    }
    throw err;
  }

  if (!createdRow) return null;
  return rowToJob(createdRow, getBookTitle(bookId));
}

export function updateProgress(
  jobId: string,
  current: number,
  total: number,
  label: string,
  status: JobStatus = 'running',
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE jobs SET status=?, progress_current=?, progress_total=?, progress_label=?, updated_at=? WHERE id=?`,
    )
    .run(status, current, total, label, now, jobId);

  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  if (row) jobEmitter.emit('update', rowToJob(row, getBookTitle(row.book_id)));
}

export function setJobStarted(jobId: string, model: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE jobs SET model=?, started_at=?, updated_at=? WHERE id=?`)
    .run(model, now, now, jobId);
}

export function setJobDone(jobId: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE jobs SET status='done', progress_label='Complete', updated_at=? WHERE id=?`)
    .run(now, jobId);
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  if (row) jobEmitter.emit('update', rowToJob(row, getBookTitle(row.book_id)));
}

export function setJobError(jobId: string, error: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE jobs SET status='error', error=?, updated_at=? WHERE id=?`)
    .run(error, now, jobId);
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  if (row) jobEmitter.emit('update', rowToJob(row, getBookTitle(row.book_id)));
}

export function cancelJob(jobId: string): boolean {
  const row = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as
    | { status: string }
    | undefined;
  if (!row) return false;

  const finished = ['done', 'cancelled', 'error', 'dismissed'].includes(row.status);

  if (finished) {
    // Dismiss: delete from DB and emit a tombstone so the frontend removes it
    getDb().prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    jobEmitter.emit('update', { id: jobId, status: 'dismissed' } as Job);
    return true;
  }

  const queuedIdx = pendingRunners.findIndex((p) => p.jobId === jobId);
  if (queuedIdx >= 0) {
    pendingRunners.splice(queuedIdx, 1);
    const now = new Date().toISOString();
    getDb()
      .prepare(`UPDATE jobs SET status='cancelled', updated_at=? WHERE id=?`)
      .run(now, jobId);
    const updated = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow;
    jobEmitter.emit('update', rowToJob(updated, getBookTitle(updated.book_id)));
    return true;
  }

  // Cancel running/pending job
  controllers.get(jobId)?.abort();
  controllers.delete(jobId);
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE jobs SET status='cancelled', updated_at=? WHERE id=?`)
    .run(now, jobId);
  const updated = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow;
  jobEmitter.emit('update', rowToJob(updated, getBookTitle(updated.book_id)));
  return true;
}

export function clearFinishedJobs(): void {
  const rows = getDb()
    .prepare(`SELECT id FROM jobs WHERE status IN ('done', 'cancelled', 'error')`)
    .all() as { id: string }[];
  getDb().prepare(`DELETE FROM jobs WHERE status IN ('done', 'cancelled', 'error')`).run();
  for (const { id } of rows) {
    jobEmitter.emit('update', { id, status: 'dismissed' } as Job);
  }
}

export function listJobs(): Job[] {
  const rows = getDb()
    .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100')
    .all() as JobRow[];
  return rows.map((r) => rowToJob(r, getBookTitle(r.book_id)));
}

export function enqueue(jobId: string, runner: JobRunner): void {
  if (activeJobCount >= MAX_CONCURRENT_JOBS) {
    if (pendingRunners.length >= MAX_PENDING_RUNNERS) {
      setJobError(jobId, 'Job queue is full; try again later.');
      return;
    }
    pendingRunners.push({ jobId, runner });
    return;
  }
  runJob(jobId, runner);
}
