/**
 * Worker process focused solely on scheduling logic
 */
import PgBoss, { Job } from 'pg-boss';
import logger from './logger';
import Robot from './models/Robot';
import { handleRunRecording } from './workflow-management/scheduler';
import { computeNextRun } from './utils/schedule';

const pgBossConnectionString = `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const pgBoss = new PgBoss({connectionString: pgBossConnectionString });

const registeredQueues = new Set<string>();

interface ScheduledWorkflowData {
  id: string;
  runId: string;
  userId: string;
}

/**
 * Utility function to schedule a cron job using PgBoss
 * @param id The robot ID
 * @param userId The user ID
 * @param cronExpression The cron expression for scheduling
 * @param timezone The timezone for the cron expression
 */
export async function scheduleWorkflow(id: string, userId: string, cronExpression: string, timezone: string): Promise<void> {
  try {
    const runId = require('uuidv4').uuid();

    const queueName = `scheduled-workflow-${id}`;
    
    logger.log('info', `Scheduling workflow ${id} with cron expression ${cronExpression} in timezone ${timezone}`);

    await pgBoss.createQueue(queueName);
    
    await pgBoss.schedule(queueName, cronExpression, 
      { id, runId, userId },
      { tz: timezone }
    );

    await registerWorkerForQueue(queueName);
    
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
    const jobs = await pgBoss.getSchedules();
    
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
      await pgBoss.unschedule(job.name);
    }
    
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to cancel scheduled workflow: ${errorMessage}`);
    throw error;
  }
}

/**
 * Process a scheduled workflow job
 */
async function processScheduledWorkflow(job: Job<ScheduledWorkflowData>) {
  const { id, runId, userId } = job.data;
  logger.log('info', `Processing scheduled workflow job for robotId: ${id}, runId: ${runId}, userId: ${userId}`);
  
  try {
    // Execute the workflow using the existing handleRunRecording function
    const result = await handleRunRecording(id, userId);
    
    // Update the robot's schedule with last run and next run times
    const robot = await Robot.findOne({ where: { 'recording_meta.id': id } });
    if (robot && robot.schedule && robot.schedule.cronExpression && robot.schedule.timezone) {
      // Update lastRunAt to the current time
      const lastRunAt = new Date();
      
      // Compute the next run date
      const nextRunAt = computeNextRun(robot.schedule.cronExpression, robot.schedule.timezone) || undefined;
      
      await robot.update({
        schedule: {
          ...robot.schedule,
          lastRunAt,
          nextRunAt,
        },
      });
      
      logger.log('info', `Updated robot ${id} schedule - next run at: ${nextRunAt}`);
    } else {
      logger.log('error', `Robot ${id} schedule, cronExpression, or timezone is missing.`);
    }
    
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Scheduled workflow job failed: ${errorMessage}`);
    return { success: false };
  }
}

/**
 * Register a worker to handle scheduled workflow jobs
 */
async function registerScheduledWorkflowWorker() {
  try {
    const jobs = await pgBoss.getSchedules();
    for (const job of jobs) {
      await pgBoss.createQueue(job.name);
      await registerWorkerForQueue(job.name);
    }
    
    logger.log('info', 'Scheduled workflow workers registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to register scheduled workflow workers: ${errorMessage}`);
  }
}

/**
 * Register a worker for a specific queue
 */
async function registerWorkerForQueue(queueName: string) {
  try {
    if (registeredQueues.has(queueName)) {
      return;
    }
    
    await pgBoss.work(queueName, async (job: Job<ScheduledWorkflowData> | Job<ScheduledWorkflowData>[]) => {
      try {
        const singleJob = Array.isArray(job) ? job[0] : job;
        return await processScheduledWorkflow(singleJob);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Scheduled workflow job failed in queue ${queueName}: ${errorMessage}`);
        throw error;
      }
    });
    
    registeredQueues.add(queueName);
    logger.log('info', `Registered worker for queue: ${queueName}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to register worker for queue ${queueName}: ${errorMessage}`);
  }
}

/**
 * Initialize PgBoss and register scheduling workers
 */
async function startScheduleWorker() {
  try {
    logger.log('info', 'Starting PgBoss scheduling worker...');
    await pgBoss.start();
    logger.log('info', 'PgBoss scheduling worker started successfully');

    // Register the scheduled workflow worker
    await registerScheduledWorkflowWorker();

    logger.log('info', 'Scheduling worker registered successfully');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to start PgBoss scheduling worker: ${errorMessage}`);
    process.exit(1);
  }
}

startScheduleWorker();

pgBoss.on('error', (error) => {
  logger.log('error', `PgBoss scheduler error: ${error.message}`);
});

process.on('SIGTERM', async () => {
  logger.log('info', 'SIGTERM received, shutting down PgBoss scheduler...');
  await pgBoss.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.log('info', 'SIGINT received, shutting down PgBoss scheduler...');
  await pgBoss.stop();
  process.exit(0);
});
