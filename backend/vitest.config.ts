import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      HOST: '127.0.0.1',
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'file:./dev.db',
      JWT_SECRET: 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
      JWT_EXPIRES_IN: '24h',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: 'claude-sonnet-5',
      ADVISOR_TIMEOUT_MS: '10000',
      RATE_LIMIT_MAX: '1000',
      RATE_LIMIT_WINDOW: '1 minute',
    },
  },
});
