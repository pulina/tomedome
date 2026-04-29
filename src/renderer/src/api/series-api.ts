import { api } from './client';
import type { Series } from '../../../shared/types';

interface SeriesAbstractResponse {
  abstract: string | null;
  abstractedAt: string | null;
}

export const seriesApi = {
  list: (): Promise<Series[]> => api.get<Series[]>('/api/series'),

  create: (title: string, description?: string): Promise<Series> =>
    api.post<Series>('/api/series', { title, description }),

  remove: (id: string): Promise<void> => api.del(`/api/series/${id}`),

  rename: (id: string, title: string): Promise<Series> =>
    api.patch<Series>(`/api/series/${id}`, { title }),

  getAbstract: (id: string): Promise<SeriesAbstractResponse> =>
    api.get<SeriesAbstractResponse>(`/api/series/${id}/abstract`),

  regenerateAbstract: (id: string): Promise<SeriesAbstractResponse> =>
    api.post<SeriesAbstractResponse>(`/api/series/${id}/abstract/regenerate`, {}),

  setBookOrder: (seriesId: string, bookIds: string[]): Promise<void> =>
    api.put<void>(`/api/series/${seriesId}/books/order`, { bookIds }),
};
