import { FastifyInstance } from 'fastify';
import type { CostPrices } from '../../shared/types';
import { getCostPricesFromDb, getStatsPayload, saveCostPrices } from '../services/stats-service';
import { schemas } from './schemas';

export async function registerStatsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/stats', async () => getStatsPayload());

  fastify.get('/api/stats/cost-prices', async () => getCostPricesFromDb());

  fastify.put<{ Body: CostPrices }>(
    '/api/stats/cost-prices',
    { schema: { body: schemas.statsCostPricesBody } },
    async (req, reply) => {
      saveCostPrices(req.body);
      return reply.code(204).send();
    },
  );
}
