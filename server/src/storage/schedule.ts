/**
 * Shared scheduling utilities
 * These functions use the shared PgBoss client to avoid connection leaks
 */
import { v4 as uuid } from 'uuid';
import logger from '../logger';
import { pgBossClient } from './pgboss';

/**
 * Utility function to schedule a cron job using PgBoss
 * @param id The robot ID
 * @param userId The user ID
 * @param cronExpression The cron expression for scheduling
 * @param timezone The timezone for the cron expression
 */
export async function scheduleWorkflow(id: string, userId: string, cronExpression: string, timezone: string): Promise<void> {
  try {
    const runId = uuid();

    const queueName = `scheduled-workflow-${id}`;

    logger.log('info', `Scheduling workflow ${id} with cron expression ${cronExpression} in timezone ${timezone}`);

    await pgBossClient.createQueue(queueName);

    await pgBossClient.schedule(queueName, cronExpression,
      { id, runId, userId },
      { tz: timezone }
    );

    logger.log('info', `Scheduled workflow job for robot ${id}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to schedule workflow: ${errorMessage}`);
    throw error;
  }
}

/**
 * Utility function to cancel a scheduled job
 * @param robotId The robot ID
 * @returns true if successful
 */
export async function cancelScheduledWorkflow(robotId: string) {
  try {
    const jobs = await pgBossClient.getSchedules();

    const matchingJobs = jobs.filter((job: any) => {
      try {
        const data = job.data;
        return data && data.id === robotId;
      } catch {
        return false;
      }
    });

    for (const job of matchingJobs) {
      logger.log('info', `Cancelling scheduled job ${job.name} for robot ${robotId}`);
      await pgBossClient.unschedule(job.name);
    }

    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to cancel scheduled workflow: ${errorMessage}`);
    throw error;
  }
}