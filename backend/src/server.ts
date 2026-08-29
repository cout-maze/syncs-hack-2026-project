import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      `API ready at http://localhost:${env.PORT}/api/v1 — docs at http://localhost:${env.PORT}/docs`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
