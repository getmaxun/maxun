/**
 * DB-backed schedule worker.
 * Polls the robot table for due scheduled robots and enqueues them
 * via Graphile Worker. No pgboss dependency.
 */
import { Op, QueryTypes, Sequelize } from 'sequelize';
import logger from './logger';
import Robot from './models/Robot';
import sequelize from './storage/db';
import { computeNextRun } from './utils/schedule';
import { addJob } from './storage/graphileWorker';
import { QUEUE_NAMES } from './task-runner';

const DB_SCHEDULER_BATCH_SIZE = 10;
const DB_SCHEDULER_POLL_MS = 30000;
const DB_SCHEDULER_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
const DB_SCHEDULER_ADVISORY_LOCK_KEY = 43821742;

let scheduleWorkerStarted = false;
let dbScheduleTickRunning = false;
const workerIntervals: NodeJS.Timeout[] = [];

interface DbScheduledRobot {
  id: string;
  robotMetaId: string;
  userId: string;
}

async function claimDueDbSchedules(): Promise<DbScheduledRobot[]> {
  const now = new Date();
  const claimExpiry = new Date(now.getTime() - DB_SCHEDULER_CLAIM_TIMEOUT_MS);

  return sequelize.transaction(async (transaction) => {
    const lockResult = await sequelize.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(:lockKey) AS locked',
      { replacements: { lockKey: DB_SCHEDULER_ADVISORY_LOCK_KEY }, type: QueryTypes.SELECT, transaction }
    );

    if (!lockResult[0]?.locked) return [];

    const dueRobots = await Robot.findAll({
      where: {
        schedule: { [Op.ne]: null },
        [Op.and]: [
          Sequelize.literal(`schedule->>'cronExpression' IS NOT NULL`),
          Sequelize.literal(`schedule->>'timezone' IS NOT NULL`),
          Sequelize.literal(`schedule->>'nextRunAt' IS NOT NULL`),
          Sequelize.literal(`schedule->>'nextRunAt' <= '${now.toISOString()}'`),
          {
            [Op.or]: [
              Sequelize.literal(`schedule->>'schedulerClaimedAt' IS NULL`),
              Sequelize.literal(`schedule->>'schedulerClaimedAt' < '${claimExpiry.toISOString()}'`),
            ],
          },
        ],
      },
      attributes: [
        'id',
        'userId',
        'schedule',
        [Sequelize.literal(`recording_meta->>'id'`), 'robotMetaId'],
      ],
      limit: DB_SCHEDULER_BATCH_SIZE,
      order: [Sequelize.literal(`schedule->>'nextRunAt' ASC`)],
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
      transaction,
    });

    const claimed: DbScheduledRobot[] = [];

    for (const robot of dueRobots) {
      const robotMetaId = robot.get('robotMetaId') as string | undefined;
      if (!robotMetaId) continue;

      await robot.update({
        schedule: { ...robot.schedule, schedulerClaimedAt: now } as any,
      }, { transaction });

      claimed.push({ id: robot.id, robotMetaId, userId: String(robot.userId) });
    }

    return claimed;
  });
}

async function finalizeSchedule(robotMetaId: string, executedAt: Date): Promise<void> {
  try {
    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotMetaId }, attributes: ['id', 'schedule'] });
    if (!robot || !robot.schedule?.cronExpression || !robot.schedule?.timezone) return;

    const nextRunAt = computeNextRun(robot.schedule.cronExpression, robot.schedule.timezone) || undefined;

    await robot.update({
      schedule: {
        ...robot.schedule,
        schedulerClaimedAt: undefined,
        lastRunAt: executedAt,
        nextRunAt,
      } as any,
    });

    logger.log('info', `Updated robot ${robotMetaId} schedule - next run at: ${nextRunAt}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to finalize schedule for robot ${robotMetaId}: ${errorMessage}`);
  }
}

async function releaseScheduleClaim(robotMetaId: string): Promise<void> {
  try {
    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotMetaId }, attributes: ['id', 'schedule'] });
    if (!robot?.schedule) return;

    await robot.update({ schedule: { ...robot.schedule, schedulerClaimedAt: undefined } as any });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to release schedule claim for robot ${robotMetaId}: ${errorMessage}`);
  }
}

async function processDueSchedules(): Promise<void> {
  if (dbScheduleTickRunning) return;
  dbScheduleTickRunning = true;

  try {
    const claimedRobots = await claimDueDbSchedules();

    for (const robot of claimedRobots) {
      const executedAt = new Date();
      let dispatched = false;

      try {
        logger.log('info', `Dispatching scheduled workflow for robot ${robot.robotMetaId}`);
        await addJob(QUEUE_NAMES.SCHEDULED_WORKFLOW, { robotMetaId: robot.robotMetaId, userId: robot.userId }, { maxAttempts: 6 });
        dispatched = true;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.log('error', `Scheduled workflow dispatch failed for robot ${robot.robotMetaId}: ${errorMessage}`);
      } finally {
        if (dispatched) {
          await finalizeSchedule(robot.robotMetaId, executedAt);
        } else {
          await releaseScheduleClaim(robot.robotMetaId);
        }
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to process DB-backed schedules: ${errorMessage}`);
  } finally {
    dbScheduleTickRunning = false;
  }
}

export async function startScheduleWorker(): Promise<void> {
  if (scheduleWorkerStarted) {
    logger.log('warn', 'Schedule worker already started, skipping...');
    return;
  }

  setImmediate(() => {
    processDueSchedules().catch((error) => {
      logger.log('error', `Initial DB schedule poll failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  const interval = setInterval(() => {
    processDueSchedules().catch((error) => {
      logger.log('error', `DB schedule poll failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, DB_SCHEDULER_POLL_MS);

  workerIntervals.push(interval);
  scheduleWorkerStarted = true;
  logger.log('info', `DB-backed schedule worker started (${DB_SCHEDULER_POLL_MS / 1000}s interval)`);
}

export async function stopScheduleWorker(): Promise<void> {
  if (!scheduleWorkerStarted) return;

  for (const interval of workerIntervals.splice(0)) {
    clearInterval(interval);
  }

  scheduleWorkerStarted = false;
  dbScheduleTickRunning = false;
  logger.log('info', 'Schedule worker stopped');
}
