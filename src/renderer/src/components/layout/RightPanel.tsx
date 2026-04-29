import { useEffect, useRef, useState } from 'react';
import { useJobs } from '../../hooks/useJobs';
import { useInspector } from '../../hooks/useInspector';
import { bookApi } from '../../api/book-api';
import { chatApi } from '../../api/chat-api';
import { ApiError } from '../../api/api-error';
import type { Job, LlmCall } from '../../../../shared/types';
import styles from './RightPanel.module.css';

type Tab = 'tasks' | 'details';

export function RightPanel() {
  const { jobs, cancel, clearFinished } = useJobs();
  const { inspectedCallId, inspectGeneration, closeInspector } = useInspector();
  const [tab, setTab] = useState<Tab>('tasks');

  async function handleResume(job: Job) {
    try {
      await bookApi.enqueueJob(job.bookId, job.type, { resume: true });
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : 'Failed to resume job');
    }
  }

  const activeJobs = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;

  // Auto-switch to Details when a call is selected from anywhere (including re-open same id)
  useEffect(() => {
    if (inspectedCallId) setTab('details');
  }, [inspectedCallId, inspectGeneration]);

  return (
    <aside className={styles.panel}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'tasks' ? styles.tabActive : ''}`}
          onClick={() => setTab('tasks')}
        >
          Tasks
          {activeJobs > 0 && <span className={styles.tabBadge}>{activeJobs}</span>}
        </button>
        <button
          className={`${styles.tab} ${tab === 'details' ? styles.tabActive : ''}`}
          onClick={() => setTab('details')}
        >
          Details
          {inspectedCallId && tab !== 'details' && <span className={styles.tabBadge}>·</span>}
        </button>
      </div>
      <div className={styles.body}>
        {tab === 'tasks' && (
          <TaskList jobs={jobs} onCancel={cancel} onClearFinished={clearFinished} onResume={handleResume} />
        )}
        {tab === 'details' && (
          <DetailsPanel callId={inspectedCallId} onClose={closeInspector} />
        )}
      </div>
    </aside>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

function TaskList({
  jobs,
  onCancel,
  onClearFinished,
  onResume,
}: {
  jobs: Job[];
  onCancel: (id: string) => void;
  onClearFinished: () => Promise<void>;
  onResume: (job: Job) => void;
}) {
  const finishedCount = jobs.filter(
    (j) => j.status === 'done' || j.status === 'cancelled' || j.status === 'error',
  ).length;

  if (jobs.length === 0) {
    return (
      <div className={styles.empty}>No tasks yet.<br />Add a book to start processing.</div>
    );
  }

  return (
    <>
      {finishedCount > 0 && (
        <div className={styles.taskHeader}>
          <button className={styles.clearBtn} onClick={() => void onClearFinished()}>
            Clear finished
          </button>
        </div>
      )}
      <div className={styles.taskList}>
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} onCancel={onCancel} onResume={onResume} />
        ))}
      </div>
    </>
  );
}

function JobCard({ job, onCancel, onResume }: { job: Job; onCancel: (id: string) => void; onResume: (job: Job) => void }) {
  const pct =
    job.progressTotal > 0 ? Math.round((job.progressCurrent / job.progressTotal) * 100) : 0;

  const startRef = useRef<number | null>(null);
  const [eta, setEta] = useState<string | null>(null);

  useEffect(() => {
    if (job.status !== 'running' || job.progressTotal === 0) return;

    if (!startRef.current && job.progressCurrent > 0) {
      startRef.current = Date.now();
    }

    if (startRef.current && job.progressCurrent >= 2) {
      const elapsed = Date.now() - startRef.current;
      const msPerStep = elapsed / (job.progressCurrent - 1);
      const remaining = (job.progressTotal - job.progressCurrent) * msPerStep;
      if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        setEta(mins < 2 ? '< 1 min' : `~${mins} min`);
      }
    }
  }, [job]);

  const statusColor: Record<string, string> = {
    pending: 'var(--color-text-muted)',
    running: 'var(--color-accent)',
    done: 'var(--color-success, #4caf50)',
    cancelled: 'var(--color-text-muted)',
    error: 'var(--color-error)',
    dismissed: 'var(--color-text-muted)',
  };

  const JOB_LABELS: Record<string, string> = {
    abstract_generation: 'Abstracts',
    embedding_generation: 'Embeddings',
  };

  const jobTypeLabel =
    job.ingestAbstractThenEmbed
      ? 'Abstracts + embeddings'
      : job.type === 'embedding_generation' && job.chainAbstractGeneration
        ? 'Embeddings + abstracts'
        : JOB_LABELS[job.type] ?? job.type;

  const STEP_LABELS: Record<string, string> = {
    abstract_generation: 'steps',
    embedding_generation: 'chunks',
  };

  const isFinished = job.status === 'done' || job.status === 'cancelled' || job.status === 'error';
  const isActive = job.status === 'pending' || job.status === 'running';

  const duration =
    isFinished && job.startedAt
      ? formatDuration(new Date(job.updatedAt).getTime() - new Date(job.startedAt).getTime())
      : null;

  return (
    <div className={styles.jobCard}>
      <div className={styles.jobHeader}>
        <span className={styles.jobBook}>{job.bookTitle}</span>
        <span
          className={styles.jobType}
          title={
            job.ingestAbstractThenEmbed
              ? 'Writes abstract summaries first, then chunk vectors and abstract vectors in one background job.'
              : job.type === 'embedding_generation' && job.chainAbstractGeneration
                ? 'Re-embeds chunk vectors to match settings, then regenerates abstract summaries and their embeddings.'
                : undefined
          }
        >
          {jobTypeLabel}
        </span>
      </div>

      {job.model && (
        <div className={styles.jobModel}>{job.model}</div>
      )}

      <div className={styles.jobStatus} style={{ color: statusColor[job.status] ?? 'inherit' }}>
        <div className={styles.jobStatusMain}>
          <span className={styles.jobStatusLabel}>
            ● {job.status}
          </span>
          {eta && job.status === 'running' && (
            <span className={styles.jobEta}>{eta} left</span>
          )}
          {duration && (
            <span className={styles.jobEta}>{duration}</span>
          )}
          {job.progressTotal > 0 && isFinished && (
            <span className={styles.jobEta}>
              {job.progressTotal} {STEP_LABELS[job.type] ?? 'steps'}
            </span>
          )}
        </div>
        <div className={styles.jobStatusActions}>
          {isActive && (
            <button
              className={styles.cancelBtn}
              onClick={() => onCancel(job.id)}
              title="Cancel"
            >
              ✕
            </button>
          )}
          {job.status === 'error' && (
            <button
              className={styles.resumeBtn}
              onClick={() => void onResume(job)}
              title="Resume — skip already-processed items and continue from where it failed"
            >
              ↻ resume
            </button>
          )}
          {isFinished && (
            <button
              className={styles.dismissBtn}
              onClick={() => onCancel(job.id)}
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {job.progressTotal > 0 && job.status !== 'cancelled' && job.status !== 'error' && (
        <>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.progressLabel}>
            {job.progressLabel}
            <span className={styles.progressPct}>{pct}%</span>
          </div>
        </>
      )}

      {job.error && <div className={styles.jobError}>{job.error}</div>}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ── Details ────────────────────────────────────────────────────────────────────

function DetailsPanel({
  callId,
  onClose,
}: {
  callId: string | null;
  onClose: () => void;
}) {
  const [call, setCall] = useState<LlmCall | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!callId) {
      setCall(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setCall(null);
    chatApi
      .getLlmCall(callId)
      .then((c) => { if (!cancelled) setCall(c); })
      .catch(() => { if (!cancelled) setCall(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [callId]);

  if (!callId) {
    return (
      <div className={styles.empty}>
        Click ◈ on a chat message or an LLM call row to inspect it here.
      </div>
    );
  }

  if (loading) return <div className={styles.empty}>Loading…</div>;
  if (!call) return <div className={styles.empty}>Call not found.</div>;

  return (
    <div className={styles.detailsWrap}>
      <div className={styles.detailsActions}>
        <button className={styles.clearBtn} onClick={onClose}>✕ clear</button>
      </div>

      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>provider</span>
        <span className={styles.detailValue}>{call.provider ?? '—'}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>model</span>
        <span className={styles.detailValue}>{call.model ?? '—'}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>purpose</span>
        <span className={styles.detailValue}>{call.purpose}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>latency</span>
        <span className={styles.detailValue}>{call.latencyMs != null ? `${call.latencyMs} ms` : '—'}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>tokens in</span>
        <span className={styles.detailValue}>{call.promptTokens ?? '—'}</span>
      </div>
      <div className={styles.detailRow}>
        <span className={styles.detailLabel}>tokens out</span>
        <span className={styles.detailValue}>{call.completionTokens ?? '—'}</span>
      </div>
      {call.error && (
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>error</span>
          <span className={`${styles.detailValue} ${styles.detailError}`}>{call.error}</span>
        </div>
      )}

      <div className={styles.detailSection}>Request</div>
      <pre className={styles.detailPre}>{formatJson(call.requestJson)}</pre>

      <div className={styles.detailSection}>Response</div>
      <pre className={styles.detailPre}>{call.responseText ?? '—'}</pre>
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
