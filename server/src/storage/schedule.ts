import logger from '../logger';
import Robot from '../models/Robot';
import { computeNextRun } from '../utils/schedule';

export async function scheduleWorkflow(id: string, userId: string, cronExpression: string, timezone: string): Promise<void> {
  try {
    const robot = await Robot.findOne({ where: { 'recording_meta.id': id } });
    if (!robot) throw new Error(`Robot ${id} not found`);

    const nextRunAt = computeNextRun(cronExpression, timezone) || undefined;

    await robot.update({
      schedule: {
        ...robot.schedule,
        cronExpression,
        timezone,
        nextRunAt,
        schedulerClaimedAt: undefined,
      } as any,
    });

    logger.log('info', `Scheduled robot ${id} (cron: ${cronExpression}, tz: ${timezone}, next: ${nextRunAt})`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to schedule workflow: ${errorMessage}`);
    throw error;
  }
}

export async function cancelScheduledWorkflow(robotId: string): Promise<boolean> {
  try {
    const robot = await Robot.findOne({ where: { 'recording_meta.id': robotId } });
    if (!robot) return true;

    if (robot.schedule) {
      await robot.update({
        schedule: {
          ...robot.schedule,
          cronExpression: undefined,
          nextRunAt: undefined,
          schedulerClaimedAt: undefined,
        } as any,
      });
    }

    logger.log('info', `Cancelled schedule for robot ${robotId}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to cancel scheduled workflow: ${errorMessage}`);
    throw error;
  }
}
