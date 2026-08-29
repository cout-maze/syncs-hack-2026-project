import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup() {
  const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: 'file:./test.db',
    RUST_LOG: process.env.RUST_LOG ?? 'debug',
  };
  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: 'inherit',
      env: testEnv,
    },
  );
}
