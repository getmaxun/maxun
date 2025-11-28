/**
 * Shared PgBoss singleton for job queue operations
 *
 * This module provides a single PgBoss instance that can be safely
 * imported by both the main server process and routes without creating
 * duplicate connection pools.
 *
 * IMPORTANT: This is separate from pgboss-worker.ts which runs in a
 * forked child process and handles job processing.
 */
import PgBoss from 'pg-boss';
import logger from '../logger';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_NAME) {
  throw new Error('One or more required environment variables are missing.');
}

const pgBossConnectionString = `postgres://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

/**
 * Shared PgBoss instance for submitting jobs (NOT processing)
 * This instance is only used to send jobs to queues, not to work on them
 */
export const pgBossClient = new PgBoss({
  connectionString: pgBossConnectionString,
  max: 3,                     // Small pool since we only send jobs
   ssl: {
    require: true,
    rejectUnauthorized: false,
   },
});

let isStarted = false;

/**
 * Initialize the PgBoss client for job submission
 * Should be called once during server startup
 */
export async function startPgBossClient(): Promise<void> {
  if (isStarted) {
    logger.log('warn', 'PgBoss client already started, skipping...');
    return;
  }

  try {
    await pgBossClient.start();
    isStarted = true;
    logger.log('info', 'PgBoss client started successfully (job submission only)');
  } catch (error: any) {
    logger.log('error', `Failed to start PgBoss client: ${error.message}`);
    throw error;
  }
}

/**
 * Stop the PgBoss client gracefully
 */
export async function stopPgBossClient(): Promise<void> {
  if (!isStarted) {
    return;
  }

  try {
    await pgBossClient.stop();
    isStarted = false;
    logger.log('info', 'PgBoss client stopped successfully');
  } catch (error: any) {
    logger.log('error', `Failed to stop PgBoss client: ${error.message}`);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  await stopPgBossClient();
});

process.on('SIGINT', async () => {
  await stopPgBossClient();
});

export default pgBossClient;