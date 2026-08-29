import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/jwt';
import type { prisma } from '../lib/db.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}
