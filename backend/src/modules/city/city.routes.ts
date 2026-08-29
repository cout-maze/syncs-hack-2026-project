import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { blockTypes } from './catalog/index.js';
import { BlockTypeSchema } from './city.schemas.js';

// TODO: BE #1 will rewrite map/sandbox routes to match specs/map-service.yaml
export default async function cityRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/catalog/block-types',
    { schema: { tags: ['catalog'], response: { 200: BlockTypeSchema.array() } } },
    async () => blockTypes,
  );
}
