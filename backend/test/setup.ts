import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Vitest starts against a clean local SQLite file in CI and on new checkouts.
// Apply the same migrations used by the application before importing test suites.
execFileSync(
  process.execPath,
  [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  },
);
