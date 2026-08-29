import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma v7 is engine-less: every database goes through an explicit driver
 * adapter (see .agents/skills/prisma-database-setup/references/sqlite.md,
 * installed by `prisma init`). One PrismaClient per process — it owns a
 * connection pool, so reuse this singleton everywhere (app, seed script, tests).
 */
function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = createPrismaClient();
