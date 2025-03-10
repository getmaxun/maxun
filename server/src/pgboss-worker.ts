/**
 * Recording worker using PgBoss for asynchronous browser recording operations
 */
import PgBoss, { Job } from 'pg-boss';
import logger from './logger';
import {
  initializeRemoteBrowserForRecording,
  destroyRemoteBrowser,
  interpretWholeWorkflow,
  stopRunningInterpretation
} from './browser-management/controller';

const pgBossConnectionString = `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

interface InitializeBrowserData {
  userId: string;
}

interface DestroyBrowserData {
  browserId: string;
}

const pgBoss = new PgBoss({connectionString: pgBossConnectionString, schema: 'public'});

/**
 * Extract data safely from a job (single job or job array)
 */
function extractJobData<T>(job: Job<T> | Job<T>[]): T {
  if (Array.isArray(job)) {
    if (job.length === 0) {
      throw new Error('Empty job array received');
    }
    return job[0].data;
  }
  return job.data;
}

/**
 * Initialize PgBoss and register all workers
 */
async function startWorkers() {
  try {
    logger.log('info', 'Starting PgBoss worker...');
    await pgBoss.start();
    logger.log('info', 'PgBoss worker started successfully');

    // Worker for initializing browser recording
    await pgBoss.work('initialize-browser-recording', async (job: Job<InitializeBrowserData> | Job<InitializeBrowserData>[]) => {
      try {
        const data = extractJobData(job);
        const userId = data.userId;
        
        logger.log('info', `Starting browser initialization job for user: ${userId}`);
        const browserId = initializeRemoteBrowserForRecording(userId);
        logger.log('info', `Browser recording job completed with browserId: ${browserId}`);
        return { browserId };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Browser recording job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for stopping a browser
    await pgBoss.work('destroy-browser', async (job: Job<DestroyBrowserData> | Job<DestroyBrowserData>[]) => {
      try {
        const data = extractJobData(job);
        const browserId = data.browserId;
        
        logger.log('info', `Starting browser destruction job for browser: ${browserId}`);
        const success = await destroyRemoteBrowser(browserId);
        logger.log('info', `Browser destruction job completed with result: ${success}`);
        return { success };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Destroy browser job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for interpreting workflow
    await pgBoss.work('interpret-workflow', async () => {
      try {
        logger.log('info', 'Starting workflow interpretation job');
        await interpretWholeWorkflow();
        logger.log('info', 'Workflow interpretation job completed');
        return { success: true };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Interpret workflow job failed: ${errorMessage}`);
        throw error;
      }
    });

    // Worker for stopping workflow interpretation
    await pgBoss.work('stop-interpretation', async () => {
      try {
        logger.log('info', 'Starting stop interpretation job');
        await stopRunningInterpretation();
        logger.log('info', 'Stop interpretation job completed');
        return { success: true };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Stop interpretation job failed: ${errorMessage}`);
        throw error;
      }
    });

    logger.log('info', 'All recording workers registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to start PgBoss workers: ${errorMessage}`);
    process.exit(1);
  }
}

// Start all workers
startWorkers();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.log('info', 'SIGTERM received, shutting down PgBoss...');
  await pgBoss.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.log('info', 'SIGINT received, shutting down PgBoss...');
  await pgBoss.stop();
  process.exit(0);
});

// For use in other files
export { pgBoss };