import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/** Shared pino config — used both here and as Fastify's `logger` option (see app.ts), so app and bootstrap logs look identical. */
export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
};

/**
 * Standalone logger for code that runs outside a Fastify request context
 * (bootstrap, the seed script). Route handlers should prefer `request.log` / `app.log`.
 */
export const logger = pino(loggerOptions);
