import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export default fp(async (app: FastifyInstance) => {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      throw AppError.unauthorized();
    }
  });

  app.decorate('optionalAuthenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      // No token or invalid — that's fine, user stays null
    }
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (request.user?.role !== 'admin') {
      throw AppError.forbidden('Requires role admin.', 'FORBIDDEN');
    }
  });
});
