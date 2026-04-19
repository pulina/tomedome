import { api } from './client';
import type { CostPrices, StatsPayload } from '@shared/types';

export const statsApi = {
  get: () => api.get<StatsPayload>('/api/stats'),
  getCostPrices: () => api.get<CostPrices>('/api/stats/cost-prices'),
  putCostPrices: (prices: CostPrices) => api.put<void>('/api/stats/cost-prices', prices),
};
