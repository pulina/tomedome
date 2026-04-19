import { api } from './client';

export const dataApi = {
  clearLogs: () => api.del('/api/logs'),
  resetAllData: () => api.del('/api/data/reset'),
};
