import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import logger from './logger';
import { handleRunRecording } from "./workflow-management/scheduler";
import Robot from './models/Robot';
import { computeNextRun } from './utils/schedule';

const connection = new IORedis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    maxRetriesPerRequest: null,
});

connection.on('connect', () => {
    console.log('Connected to Redis!');
});

connection.on('error', (err) => {
    console.error('Redis connection error:', err);
});

const workflowQueue = new Queue('workflow', { connection });

const worker = new Worker('workflow', async job => {
    const { runId, userId, id } = job.data;
    try {
        const result = await handleRunRecording(id, userId);
        return result;
    } catch (error) {
        logger.error('Error running workflow:', error);
        throw error;
    }
}, { connection });

worker.on('completed', async (job: any) => {
    logger.log(`info`, `Job ${job.id} completed for ${job.data.runId}`);
    const robot = await Robot.findOne({ where: { 'recording_meta.id': job.data.id } });
    if (robot) {
        // Update `lastRunAt` to the current time
        const lastRunAt = new Date();

        // Compute the next run date
        if (robot.schedule && robot.schedule.cronExpression && robot.schedule.timezone) {
            const nextRunAt = computeNextRun(robot.schedule.cronExpression, robot.schedule.timezone) || undefined;
            await robot.update({
                schedule: {
                    ...robot.schedule,
                    lastRunAt,
                    nextRunAt,
                },
            });
        } else {
            logger.error('Robot schedule, cronExpression, or timezone is missing.');
        }
    }
});

worker.on('failed', async (job: any, err) => {
    logger.log(`error`, `Job ${job.id} failed for ${job.data.runId}:`, err);
});

console.log('Worker is running...');

async function jobCounts() {
    const jobCounts = await workflowQueue.getJobCounts();
}

jobCounts();

process.on('SIGINT', () => {
    console.log('Worker shutting down...');
    process.exit();
});

export { workflowQueue, worker };