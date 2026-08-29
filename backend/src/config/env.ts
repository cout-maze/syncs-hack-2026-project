import { z } from 'zod';
import { logger } from '../lib/logger.js';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required, e.g. file:./dev.db'),

  JWT_SECRET: z
    .string()
    .min(
      32,
      "JWT_SECRET must be at least 32 characters — generate one with node -e \"console.log(require('node:crypto').randomBytes(48).toString('hex'))\"",
    ),
  JWT_EXPIRES_IN: z.string().default('24h'),

  LLM_PROVIDER: z.enum(['anthropic', 'ollama']).default('anthropic'),

  // Anthropic — used when LLM_PROVIDER=anthropic
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  // Ollama — used when LLM_PROVIDER=ollama
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1'),

  ADVISOR_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues }, 'Invalid environment configuration');
    for (const issue of parsed.error.issues) {
      logger.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const advisorEnabled =
  env.LLM_PROVIDER === 'ollama' || env.ANTHROPIC_API_KEY.length > 0;
