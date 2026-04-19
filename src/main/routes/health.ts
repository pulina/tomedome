import { FastifyInstance } from 'fastify';
import { app } from 'electron';

export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', const: 'ok' },
              version: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: app.getVersion(),
    }),
  );
}
