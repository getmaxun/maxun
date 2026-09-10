import Run from '../models/Run';
import {
  COMPARABLE_SCREENSHOT_FORMATS,
  compareScreenshots,
  ScreenshotComparisonResult,
} from './screenshot-comparison';

export const COMPARABLE_RUN_FORMATS = ['text', 'markdown', 'html'] as const;
export type ComparableRunFormat = (typeof COMPARABLE_RUN_FORMATS)[number];

const getRunTimestamp = (run: any): number => {
  const timestamp = Date.parse(run.finishedAt || run.startedAt || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

/**
 * Collapses whitespace so text comparisons ignore formatting-only changes.
 */
export const normalizeComparableText = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Finds the latest successful run for the same robot completed before the current run.
 */
export async function findPreviousSuccessfulRun(currentRun: any) {
  const runs = await Run.findAll({
    where: {
      robotMetaId: currentRun.robotMetaId,
      status: 'success',
    },
    attributes: ['runId', 'finishedAt', 'startedAt', 'serializableOutput', 'binaryOutput'],
  });

  const currentTimestamp = getRunTimestamp(currentRun);
  const previousRuns = runs
    .filter((run: any) => run.runId !== currentRun.runId)
    .filter((run: any) => {
      if (!currentTimestamp) return true;
      const runTimestamp = getRunTimestamp(run);
      return runTimestamp > 0 && runTimestamp <= currentTimestamp;
    })
    .sort((a: any, b: any) => getRunTimestamp(b) - getRunTimestamp(a));

  return previousRuns[0] || null;
}

/**
 * Compares the current run's text output against the previous successful run's text output.
 */
export async function compareRunTextWithPrevious(currentRun: any, currentText: string) {
  const previousRun = await findPreviousSuccessfulRun(currentRun);
  if (!previousRun) {
    return { previousRun: null, hasChanges: false };
  }

  const previousText = previousRun.serializableOutput?.text?.[0]?.content;
  const hasChanges = normalizeComparableText(previousText ?? '') !== normalizeComparableText(currentText ?? '');

  return { previousRun, hasChanges };
}

/**
 * Compares every text-based output produced by the current run against the
 * matching output from the previous successful run.
 */
export async function compareRunOutputsWithPrevious(currentRun: any, currentOutput: any, currentBinaryOutput?: any) {
  const previousRun = await findPreviousSuccessfulRun(currentRun);
  if (!previousRun) {
    return {
      previousRun: null,
      hasChanges: false,
      changedFormats: [] as string[],
      screenshotComparisons: {} as Partial<Record<string, ScreenshotComparisonResult>>,
      screenshotDiffs: {} as Record<string, Buffer>,
    };
  }

  const changedFormats: string[] = COMPARABLE_RUN_FORMATS.filter((format) => {
    const currentContent = currentOutput?.[format]?.[0]?.content;
    if (typeof currentContent !== 'string') return false;

    const previousValue = previousRun.serializableOutput?.[format]?.[0]?.content;
    const previousContent = typeof previousValue === 'string' ? previousValue : '';
    return normalizeComparableText(previousContent) !== normalizeComparableText(currentContent);
  });

  const screenshotComparisons: Partial<Record<string, ScreenshotComparisonResult>> = {};
  const screenshotDiffs: Record<string, Buffer> = {};
  for (const format of COMPARABLE_SCREENSHOT_FORMATS) {
    if (!currentBinaryOutput?.[format]) continue;
    const comparison = await compareScreenshots(currentBinaryOutput[format], previousRun.binaryOutput?.[format]);
    if (!comparison) continue;
    screenshotComparisons[format] = comparison;
    if (comparison.changed) {
      changedFormats.push(format);
      if (comparison.diff) screenshotDiffs[`${format}-diff`] = comparison.diff;
    }
  }

  return {
    previousRun,
    hasChanges: changedFormats.length > 0,
    changedFormats,
    screenshotComparisons,
    screenshotDiffs,
  };
}

const stableValue = (value: any): any => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === 'object'
    ? Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: stableValue(value[key]) }), {})
    : value;

export const serializeCapturedText = (value: any) => JSON.stringify(stableValue(value || {}), null, 2);

/** Compares named text and screenshot captures produced by an extract robot. */
export async function compareExtractRunWithPrevious(currentRun: any, currentOutput: any, binaryOutput: any) {
  const previousRun = await findPreviousSuccessfulRun(currentRun);
  if (!previousRun) {
    return {
      previousRun: null,
      hasChanges: false,
      changedFormats: [] as string[],
      screenshotComparisons: {} as Record<string, ScreenshotComparisonResult>,
      screenshotDiffs: {} as Record<string, Buffer>,
    };
  }

  const changedFormats: string[] = [];
  if (serializeCapturedText(currentOutput?.scrapeSchema) !== serializeCapturedText(previousRun.serializableOutput?.scrapeSchema)) {
    changedFormats.push('captured-text');
  }

  const screenshotComparisons: Record<string, ScreenshotComparisonResult> = {};
  const screenshotDiffs: Record<string, Buffer> = {};
  for (const name of Object.keys(binaryOutput || {}).filter((key) => !key.endsWith('-diff'))) {
    const comparison = await compareScreenshots(binaryOutput[name], previousRun.binaryOutput?.[name]);
    if (!comparison) continue;
    screenshotComparisons[name] = comparison;
    if (comparison.changed) {
      changedFormats.push(`screenshot:${name}`);
      if (comparison.diff) screenshotDiffs[`${name}-diff`] = comparison.diff;
    }
  }

  return {
    previousRun,
    hasChanges: changedFormats.length > 0,
    changedFormats,
    screenshotComparisons,
    screenshotDiffs,
  };
}
