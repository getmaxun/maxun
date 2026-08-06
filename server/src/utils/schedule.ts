import cronParser from 'cron-parser';
import moment from 'moment-timezone';
import cron from 'node-cron';

// Function to compute next run date based on the cron pattern and timezone
export function computeNextRun(cronExpression: string, timezone: string) {
  try {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone });
    return interval.next().toDate();
  } catch (err) {
    console.error('Error parsing cron expression:', err);
    return null;
  }
}

/**
 * Thrown by buildCronExpression when the schedule input is invalid.
 * `field` names the offending input so callers can surface it in a 400 response.
 */
export class ScheduleValidationError extends Error {
  public field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
    this.field = field;
  }
}

export type RunEveryUnit = 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';

export interface ScheduleInput {
  runEvery: number;
  runEveryUnit: RunEveryUnit;
  startFrom: string;
  atTimeStart: string;
  atTimeEnd: string;
  timezone: string;
  dayOfMonth?: string;
}

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * Validates schedule inputs and builds a cron expression from the structured
 * UI/API fields. Owns EVERY schedule validation (timezone, time format, day,
 * unit, generated-cron sanity) so both the dashboard route and the API route
 * share one implementation. Throws ScheduleValidationError on any bad input.
 */
export function buildCronExpression(input: ScheduleInput): { cronExpression: string } {
  const { runEvery, runEveryUnit, startFrom, atTimeStart, atTimeEnd, timezone, dayOfMonth } = input;

  // Required parameters
  if (runEvery === undefined || runEvery === null || !runEveryUnit || !startFrom || !atTimeStart || !atTimeEnd || !timezone) {
    throw new ScheduleValidationError('body', 'Missing required parameters');
  }

  // Timezone
  if (!moment.tz.zone(timezone)) {
    throw new ScheduleValidationError('timezone', 'Invalid timezone');
  }

  // Time format
  const [startHours, startMinutes] = String(atTimeStart).split(':').map(Number);
  const [endHours, endMinutes] = String(atTimeEnd).split(':').map(Number);

  if (isNaN(startHours) || isNaN(startMinutes) || isNaN(endHours) || isNaN(endMinutes) ||
    startHours < 0 || startHours > 23 || startMinutes < 0 || startMinutes > 59 ||
    endHours < 0 || endHours > 23 || endMinutes < 0 || endMinutes > 59) {
    throw new ScheduleValidationError('atTimeStart', 'Invalid time format');
  }

  // Start day
  if (!DAYS.includes(startFrom)) {
    throw new ScheduleValidationError('startFrom', 'Invalid start day');
  }

  // For sub-daily units, atTimeStart/atTimeEnd bound an "in between" window
  // (see the dashboard schedule UI), so the end must be strictly after the start.
  if (runEveryUnit === 'MINUTES' || runEveryUnit === 'HOURS') {
    if (endHours * 60 + endMinutes <= startHours * 60 + startMinutes) {
      throw new ScheduleValidationError('atTimeEnd', 'End time must be after start time');
    }
    // An hourly interval needs the window to cross an hour boundary; a same-hour
    // window can't produce a valid hour range for the cron step.
    if (runEveryUnit === 'HOURS' && startHours === endHours) {
      throw new ScheduleValidationError('atTimeEnd', 'Hourly schedules need a window spanning at least one hour');
    }
  }

  // cron has no field for multi-week intervals; a day-of-week field can only
  // say "every week on day X", so reject anything the schedule can't honor.
  if (runEveryUnit === 'WEEKS' && runEvery > 1) {
    throw new ScheduleValidationError('runEvery', 'Weekly schedules only support an interval of 1');
  }

  const dom = Number(dayOfMonth);
  if (runEveryUnit === 'MONTHS' && (!dayOfMonth || !Number.isInteger(dom) || dom < 1 || dom > 31)) {
    throw new ScheduleValidationError('dayOfMonth', 'Invalid day of month');
  }

  // Build cron expression based on run frequency and starting day
  let cronExpression: string | undefined;
  const dayIndex = DAYS.indexOf(startFrom);

  switch (runEveryUnit) {
    case 'MINUTES':
      cronExpression = `*/${runEvery} ${startHours}-${endHours} * * *`;
      break;
    case 'HOURS':
      cronExpression = `${startMinutes} ${startHours}-${endHours}/${runEvery} * * *`;
      break;
    case 'DAYS':
      cronExpression = `${startMinutes} ${startHours} */${runEvery} * *`;
      break;
    case 'WEEKS':
      cronExpression = `${startMinutes} ${startHours} * * ${dayIndex}`;
      break;
    case 'MONTHS':
      // todo: handle leap year
      cronExpression = `${startMinutes} ${startHours} ${dom} */${runEvery} *`;
      break;
    default:
      throw new ScheduleValidationError('runEveryUnit', 'Invalid runEveryUnit');
  }

  // Validate generated cron expression
  if (!cronExpression || !cron.validate(cronExpression)) {
    throw new ScheduleValidationError('runEvery', 'Invalid cron expression generated');
  }

  return { cronExpression };
}
