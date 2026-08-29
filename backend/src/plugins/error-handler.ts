import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

const STATUS_CODE_TO_ERROR_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Every non-2xx response, whatever raised it, comes out shaped
 * { "error": { "code", "message", "details?" } } (docs/04-be1-auth-city.md).
 */
export default fp(async (app: FastifyInstance) => {
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No route matches ${request.method} ${request.url}.`,
      },
    });
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.code(error.statusCode).send(error.toJSON());
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request did not match the expected schema.',
          details: { issues: error.validation },
        },
      });
    }

    if (isResponseSerializationError(error)) {
      // A bug on our side (handler returned something that doesn't match its
      // declared response schema) — log loudly, never leak the shape to the client.
      request.log.error({ err: error }, 'Response failed schema validation');
      return reply.code(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our end.' },
      });
    }

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const code = STATUS_CODE_TO_ERROR_CODE[statusCode] ?? 'INTERNAL_ERROR';

    if (statusCode >= 500) {
      request.log.error({ err: error }, error.message);
      return reply.code(statusCode).send({
        error: { code, message: 'Something went wrong on our end.' },
      });
    }

    // 4xx from Fastify itself (bad JSON body, payload too large, rate limit, ...).
    return reply.code(statusCode).send({
      error: { code, message: error.message },
    });
  });
});
