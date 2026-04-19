import { useCallback, useEffect, useRef, useState } from 'react';
import { jobApi } from '../api/job-api';
import type { Job } from '../../../shared/types';

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const closeRef = useRef<(() => void) | null>(null);

  const upsert = useCallback((job: Job) => {
    // dismissed = tombstone: remove from local state
    if (job.status === 'dismissed') {
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      return;
    }
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j.id === job.id);
      if (idx === -1) return [job, ...prev];
      const next = [...prev];
      next[idx] = job;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    jobApi.list().then((list) => {
      if (!cancelled) setJobs(list.filter((j) => j.status !== 'dismissed'));
    });

    jobApi.openStream(upsert).then((close) => {
      if (cancelled) close();
      else closeRef.current = close;
    });

    return () => {
      cancelled = true;
      closeRef.current?.();
      closeRef.current = null;
    };
  }, [upsert]);

  const cancel = useCallback(async (id: string) => {
    try { await jobApi.cancel(id); } catch { /* already finished */ }
  }, []);

  const clearFinished = useCallback(async () => {
    try { await jobApi.clearFinished(); } catch { /* ignore */ }
  }, []);

  return { jobs, cancel, clearFinished };
}
