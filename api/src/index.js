import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { ensureAdmin, seedDemo } from './bootstrap.js';
import { createApp } from './app.js';
import { startJobs } from './services/jobs.js';

async function main() {
  await migrate(logger);
  await ensureAdmin();
  await seedDemo();

  const app = createApp();
  const server = app.listen(config.port, () => logger.info(`BioLoop API listening on :${config.port}`));
  // Slightly above Render's load balancer keep-alive to avoid dropped connections
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const stopJobs = startJobs();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    stopJobs();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
