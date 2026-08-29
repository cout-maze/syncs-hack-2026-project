import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/**
 * JWT auth, shared by every module (docs/04-be1-auth-city.md: "nothing else
 * may import auth internals — only the middleware + User shape"). Claims:
 * `sub` (user id), `email`, 24h expiry by default.
 */
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
});
