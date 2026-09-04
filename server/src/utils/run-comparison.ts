import Run from '../models/Run';

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
