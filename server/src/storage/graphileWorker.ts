import { makeWorkerUtils, WorkerUtils } from 'graphile-worker';
import { Pool } from 'pg';
import logger from '../logger';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST || !process.env.DB_PORT || !process.env.DB_NAME) {
  throw new Error('One or more required environment variables are missing.');
}

const connectionString = `postgres://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD!)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
const useSSL = process.env.DB_SSL === 'true';

let utilsPool: Pool | null = null;
let workerUtils: WorkerUtils | null = null;
let isStarted = false;

export async function startGraphileWorkerUtils(): Promise<void> {
  if (isStarted) {
    logger.log('warn', 'Graphile Worker utils already started, skipping...');
    return;
  }

  try {
    utilsPool = new Pool({
      connectionString,
      max: 3,
      ssl: useSSL ? true : undefined,
    });

    workerUtils = await makeWorkerUtils({ pgPool: utilsPool });
    await workerUtils.migrate();
    isStarted = true;
    logger.log('info', 'Graphile Worker utils started');
  } catch (error: any) {
    logger.log('error', `Failed to start Graphile Worker utils: ${error.message}`);
    throw error;
  }
}

export async function stopGraphileWorkerUtils(): Promise<void> {
  if (!isStarted) return;

  try {
    if (workerUtils) {
      await workerUtils.release();
      workerUtils = null;
    }
    if (utilsPool) {
      await utilsPool.end();
      utilsPool = null;
    }
    isStarted = false;
    logger.log('info', 'Graphile Worker utils stopped');
  } catch (error: any) {
    logger.log('error', `Failed to stop Graphile Worker utils: ${error.message}`);
  }
}

export async function addJob(
  taskIdentifier: string,
  payload: Record<string, unknown>,
  options?: { maxAttempts?: number; runAt?: Date; jobKey?: string },
): Promise<string> {
  if (!workerUtils) {
    throw new Error('Graphile Worker utils not initialized — call startGraphileWorkerUtils first');
  }
  const job = await workerUtils.addJob(taskIdentifier, payload, options);
  return String(job.id);
}

process.on('SIGTERM', async () => {
  await stopGraphileWorkerUtils();
});

process.on('SIGINT', async () => {
  await stopGraphileWorkerUtils();
});
