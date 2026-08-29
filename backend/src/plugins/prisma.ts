import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { prisma } from '../lib/db.js';

export default fp(async (app: FastifyInstance) => {
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
