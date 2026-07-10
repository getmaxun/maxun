/**
 * Regression tests for the O(n^2) fix on top of getmaxun/maxun#1104's incremental persistence:
 * crawl/search deliver the FULL cumulative snapshot on every page (so the in-memory cache and
 * socket broadcast stay simple), but persisting that full snapshot on every single page write
 * would resend every prior page's data again and again. computeCrawlSearchPersistDelta slices
 * off just the new items before they reach the persistence buffer, and mergeCrawlDelta /
 * mergeSearchDelta append that delta onto the existing DB state instead of overwriting it.
 *
 * These are pure, stateful-but-isolated methods (no DB/socket involved), extracted specifically
 * so this logic can be verified directly without driving a full interpreter run.
 */
jest.mock('../../../models/Run', () => ({ __esModule: true, default: {} }));
// Interpreter.ts imports BinaryOutputService for the per-page screenshot upload path (#1105) -
// mock it so importing the module under test doesn't attempt a real MinIO connection.
jest.mock('../../../storage/mino', () => ({ BinaryOutputService: jest.fn() }));

import { WorkflowInterpreter } from '../Interpreter';
import type { Socket } from 'socket.io';

function createInterpreter(): any {
  const fakeSocket = { emit: jest.fn(), nsp: { emit: jest.fn() } } as unknown as Socket;
  return new WorkflowInterpreter(fakeSocket, 'test-run-id') as any;
}

describe('computeCrawlSearchPersistDelta', () => {
  it('passes non-crawl/search types through unchanged', () => {
    const interp = createInterpreter();
    const result = interp.computeCrawlSearchPersistDelta('scrapeList', 'List 1', { a: 1 });
    expect(result).toEqual({ dataToPersist: { a: 1 }, skip: false });
  });

  it('slices only the new crawl pages on each successive call', () => {
    const interp = createInterpreter();

    const call1 = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'p1' }]);
    expect(call1.skip).toBe(false);
    expect(call1.dataToPersist).toEqual([{ url: 'p1' }]);

    const call2 = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'p1' }, { url: 'p2' }]);
    expect(call2.skip).toBe(false);
    expect(call2.dataToPersist).toEqual([{ url: 'p2' }]);

    const call3 = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'p1' }, { url: 'p2' }, { url: 'p3' }]);
    expect(call3.dataToPersist).toEqual([{ url: 'p3' }]);
  });

  it('always persists the first call even with an empty crawl result set', () => {
    const interp = createInterpreter();
    const result = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', []);
    expect(result.skip).toBe(false);
    expect(result.dataToPersist).toEqual([]);
  });

  it('skips a redundant repeat call with nothing new after the first persist', () => {
    const interp = createInterpreter();
    interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'p1' }]);
    // e.g. the harmless final safety-net call after the loop, when nothing changed since the
    // last per-page call
    const redundant = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'p1' }]);
    expect(redundant.skip).toBe(true);
    expect(redundant.dataToPersist).toEqual([]);
  });

  it('tracks crawl and search deltas independently even with the same underlying counts', () => {
    const interp = createInterpreter();
    interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'c1' }]);
    const searchFirst = interp.computeCrawlSearchPersistDelta('search', 'Search Results', {
      query: 'q', provider: 'duckduckgo', results: [{ url: 's1' }], resultsCount: 1,
    });
    expect(searchFirst.skip).toBe(false);
    expect(searchFirst.dataToPersist.results).toEqual([{ url: 's1' }]);

    // A second crawl page must not be affected by the search call above, and vice versa.
    const crawlSecond = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [{ url: 'c1' }, { url: 'c2' }]);
    expect(crawlSecond.dataToPersist).toEqual([{ url: 'c2' }]);
  });

  it('slices only the new search results and refreshes metadata on each call', () => {
    const interp = createInterpreter();

    const call1 = interp.computeCrawlSearchPersistDelta('search', 'Search Results', {
      query: 'test', provider: 'duckduckgo', mode: 'scrape', results: [{ url: 's1' }], resultsCount: 1, searchedAt: 't1',
    });
    expect(call1.dataToPersist).toEqual({
      query: 'test', provider: 'duckduckgo', mode: 'scrape', results: [{ url: 's1' }], resultsCount: 1, searchedAt: 't1',
    });

    const call2 = interp.computeCrawlSearchPersistDelta('search', 'Search Results', {
      query: 'test', provider: 'duckduckgo', mode: 'scrape', results: [{ url: 's1' }, { url: 's2' }], resultsCount: 2, searchedAt: 't2',
    });
    // Only the new result should be in the delta, but metadata (searchedAt) is still the latest.
    expect(call2.dataToPersist.results).toEqual([{ url: 's2' }]);
    expect(call2.dataToPersist.searchedAt).toBe('t2');
  });
});

describe('mergeCrawlDelta', () => {
  it('appends a delta onto an empty/missing existing state', () => {
    const interp = createInterpreter();
    const merged = interp.mergeCrawlDelta(undefined, { 'Crawl Results': [{ url: 'p1' }] });
    expect(merged).toEqual({ 'Crawl Results': [{ url: 'p1' }] });
  });

  it('appends successive deltas without dropping or duplicating prior pages', () => {
    const interp = createInterpreter();
    let state: Record<string, any> = {};
    state = interp.mergeCrawlDelta(state, { 'Crawl Results': [{ url: 'p1' }] });
    state = interp.mergeCrawlDelta(state, { 'Crawl Results': [{ url: 'p2' }] });
    state = interp.mergeCrawlDelta(state, { 'Crawl Results': [{ url: 'p3' }] });

    expect(state['Crawl Results']).toEqual([{ url: 'p1' }, { url: 'p2' }, { url: 'p3' }]);
  });

  it('does not mutate the previous state object in place', () => {
    const interp = createInterpreter();
    const original = { 'Crawl Results': [{ url: 'p1' }] };
    const merged = interp.mergeCrawlDelta(original, { 'Crawl Results': [{ url: 'p2' }] });

    expect(original['Crawl Results']).toEqual([{ url: 'p1' }]);
    expect(merged['Crawl Results']).toEqual([{ url: 'p1' }, { url: 'p2' }]);
  });
});

describe('mergeSearchDelta', () => {
  it('appends results and refreshes metadata, recomputing resultsCount from the merged array', () => {
    const interp = createInterpreter();
    let state: Record<string, any> = {};

    state = interp.mergeSearchDelta(state, {
      'Search Results': { query: 'q', provider: 'duckduckgo', mode: 'scrape', results: [{ url: 's1' }], resultsCount: 1, searchedAt: 't1' },
    });
    state = interp.mergeSearchDelta(state, {
      'Search Results': { query: 'q', provider: 'duckduckgo', mode: 'scrape', results: [{ url: 's2' }], resultsCount: 2, searchedAt: 't2' },
    });

    expect(state['Search Results'].results).toEqual([{ url: 's1' }, { url: 's2' }]);
    expect(state['Search Results'].resultsCount).toBe(2);
    expect(state['Search Results'].searchedAt).toBe('t2');
  });
});

describe('computeCrawlSearchPersistDelta + mergeCrawlDelta end-to-end', () => {
  it('reconstructs the exact full page sequence with no duplicates or gaps across many pages', () => {
    const interp = createInterpreter();
    let dbState: Record<string, any> = {};
    const cumulative: any[] = [];

    for (let i = 1; i <= 10; i++) {
      cumulative.push({ url: `page${i}` });
      const { dataToPersist, skip } = interp.computeCrawlSearchPersistDelta('crawl', 'Crawl Results', [...cumulative]);
      if (!skip) {
        dbState.crawl = interp.mergeCrawlDelta(dbState.crawl, { 'Crawl Results': dataToPersist });
      }
    }

    expect(dbState.crawl['Crawl Results']).toEqual(cumulative);
    expect(dbState.crawl['Crawl Results']).toHaveLength(10);
  });
});
