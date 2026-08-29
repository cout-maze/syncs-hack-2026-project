import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export default fp(async (app: FastifyInstance) => {
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(helmet, {
    // This is a JSON API; the only HTML it serves is the self-hosted Swagger UI
    // at /docs, whose inline scripts a default CSP would otherwise block.
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: (_request, context) =>
      new AppError(
        429,
        'RATE_LIMITED',
        `Too many requests — try again in ${context.after}.`,
      ).toJSON(),
  });
});
