/**
 * Regression tests for two CodeRabbit findings on PR #1138:
 *
 * 1. (Major) hasData's scrapeSchema/scrapeList checks used `.length > 0`, but both are always
 *    plain objects keyed by action name, never arrays - `.length` on a plain object is
 *    `undefined`, so `undefined > 0` is always false. isPartial could never be true for a run
 *    whose only partial output was scrapeSchema/scrapeList.
 * 2. (Major) abortRun reloaded the run before checking for partial data, but never forced the
 *    interpreter's persistence buffer to flush first - scrapeList isn't on the immediate-flush
 *    allowlist, so a buffered-but-not-yet-written scrapeList page could be invisible to the
 *    reload.
 *
 * Both bugs are now fixed in one place (hasPartialOutput / flushReloadAndCheckPartialOutput)
 * instead of duplicated inline in task-runner.ts's two call sites, which is how the same bug
 * ended up in two places to begin with.
 */
import { hasPartialOutput, flushReloadAndCheckPartialOutput, RunLike, BrowserLike } from '../output-validation';

describe('hasPartialOutput', () => {
  it('returns true when scrapeSchema has keys (regression: .length > 0 never matched a plain object)', () => {
    expect(hasPartialOutput({ scrapeSchema: { field1: 'value' } }, {})).toBe(true);
  });

  it('returns true when scrapeList has keys (same regression, scrapeList side)', () => {
    expect(hasPartialOutput({ scrapeList: { 'List 1': [{ a: 1 }] } }, {})).toBe(true);
  });

  it('returns true when crawl has keys', () => {
    expect(hasPartialOutput({ crawl: { 'Crawl Results': [{ url: 'p1' }] } }, {})).toBe(true);
  });

  it('returns true when search has keys', () => {
    expect(hasPartialOutput({ search: { 'Search Results': { results: [] } } }, {})).toBe(true);
  });

  it('returns true when only binaryOutput has keys', () => {
    expect(hasPartialOutput({}, { 'screenshot-1': { data: 'abc' } })).toBe(true);
  });

  it('returns false when every field is an empty object', () => {
    expect(hasPartialOutput(
      { scrapeSchema: {}, scrapeList: {}, crawl: {}, search: {} },
      {}
    )).toBe(false);
  });

  it('returns false for null/undefined inputs without throwing', () => {
    expect(hasPartialOutput(null, null)).toBe(false);
    expect(hasPartialOutput(undefined, undefined)).toBe(false);
  });

  it('is not fooled by an actual array slipping in (defensive, matches Interpreter.ts normalization)', () => {
    // Interpreter.ts normalizes these to {} if ever caught as arrays, but hasPartialOutput
    // should behave sanely either way rather than assuming the object shape.
    expect(hasPartialOutput({ scrapeSchema: [] }, {})).toBe(false);
    expect(hasPartialOutput({ scrapeSchema: [{ a: 1 }] }, {})).toBe(true);
  });
});

describe('flushReloadAndCheckPartialOutput', () => {
  function fakeRun(overrides: Partial<RunLike> = {}): RunLike & { reload: jest.Mock } {
    return {
      serializableOutput: {},
      binaryOutput: {},
      reload: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as RunLike & { reload: jest.Mock };
  }

  function fakeBrowser(flushImpl?: () => Promise<void>): BrowserLike & { interpreter: { flushPersistenceBuffer: jest.Mock } } {
    return {
      interpreter: {
        flushPersistenceBuffer: jest.fn(flushImpl ?? (() => Promise.resolve())),
      },
    };
  }

  it('flushes the persistence buffer before reloading the run (ordering matters)', async () => {
    const callOrder: string[] = [];
    const run = fakeRun();
    (run.reload as jest.Mock).mockImplementation(async () => { callOrder.push('reload'); });
    const browser = fakeBrowser(async () => { callOrder.push('flush'); });

    await flushReloadAndCheckPartialOutput(run, browser);

    expect(callOrder).toEqual(['flush', 'reload']);
  });

  it('reflects data that only appears after reload (proves it reads run state post-reload, not pre-reload)', async () => {
    const run = fakeRun({ serializableOutput: {} });
    (run.reload as jest.Mock).mockImplementation(async () => {
      // Simulate the reload picking up a scrapeList page that was buffered/flushed concurrently.
      run.serializableOutput = { scrapeList: { 'List 1': [{ a: 1 }] } };
    });
    const browser = fakeBrowser();

    const result = await flushReloadAndCheckPartialOutput(run, browser);

    expect(result).toBe(true);
  });

  it('still reloads and checks when there is no browser/interpreter at all', async () => {
    const run = fakeRun({ serializableOutput: { crawl: { 'Crawl Results': [{ url: 'p1' }] } } });

    const result = await flushReloadAndCheckPartialOutput(run, null);

    expect(run.reload).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('does not call flushPersistenceBuffer when interpreter is missing', async () => {
    const run = fakeRun();
    const browserWithoutInterpreter: BrowserLike = {};

    await flushReloadAndCheckPartialOutput(run, browserWithoutInterpreter);

    expect(run.reload).toHaveBeenCalledTimes(1);
  });

  it('swallows a flushPersistenceBuffer rejection and still reloads and checks', async () => {
    const run = fakeRun({ serializableOutput: { crawl: { 'Crawl Results': [{ url: 'p1' }] } } });
    const browser = fakeBrowser(() => Promise.reject(new Error('flush boom')));

    const result = await expect(flushReloadAndCheckPartialOutput(run, browser)).resolves.toBe(true);
    expect(run.reload).toHaveBeenCalledTimes(1);
  });

  it('swallows a run.reload rejection and still checks whatever is already on run', async () => {
    const run = fakeRun({ serializableOutput: { search: { 'Search Results': { results: [{ url: 's1' }] } } } });
    (run.reload as jest.Mock).mockRejectedValue(new Error('reload boom'));
    const browser = fakeBrowser();

    const result = await flushReloadAndCheckPartialOutput(run, browser);

    expect(result).toBe(true);
  });
});
