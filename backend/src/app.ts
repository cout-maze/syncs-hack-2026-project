import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { loggerOptions } from './lib/logger.js';
import advisorRoutes from './modules/advisor/advisor.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import cityRoutes from './modules/city/city.routes.js';
import proposalsRoutes from './modules/proposals/proposals.routes.js';
import authPlugin from './plugins/auth.js';
import docsPlugin from './plugins/docs.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import prismaPlugin from './plugins/prisma.js';
import securityPlugin from './plugins/security.js';

/**
 * Builds (but does not start) the Fastify app — one instance, four
 * route-group modules under /api/v1 (docs/00-architecture-overview.md).
 * Kept separate from server.ts so tests can `buildApp()` and `.inject()`
 * without binding a port.
 */
export async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    // Simulation paths are persisted verbatim for replay and Advisor analysis.
    // A generated 30x30 city can legitimately exceed Fastify's 1 MiB default
    // request limit, which otherwise surfaces in browsers as `Failed to fetch`.
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Cross-cutting plugins first, so every route below gets them.
  await app.register(errorHandlerPlugin);
  await app.register(prismaPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(docsPlugin);

  app.get('/health', async () => ({ status: 'ok' as const }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(cityRoutes);
      await api.register(proposalsRoutes);
      await api.register(advisorRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
