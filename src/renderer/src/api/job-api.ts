import { api, resolveBaseUrl } from './client';
import type { Job } from '../../../shared/types';

export const jobApi = {
  list: (): Promise<Job[]> => api.get<Job[]>('/api/jobs'),

  // cancel (running/pending) or dismiss (finished) a single job
  cancel: (id: string): Promise<void> => api.del(`/api/jobs/${id}`),

  clearFinished: (): Promise<void> => api.del('/api/jobs'),

  openStream: async (onJob: (job: Job) => void): Promise<() => void> => {
    const base = await resolveBaseUrl();
    const es = new EventSource(`${base}/api/jobs/stream`);
    es.onmessage = (e) => {
      try {
        onJob(JSON.parse(e.data as string) as Job);
      } catch {
        // ignore malformed events
      }
    };
    return () => es.close();
  },
};
