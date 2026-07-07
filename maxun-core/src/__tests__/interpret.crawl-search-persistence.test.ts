/**
 * Regression tests for getmaxun/maxun#1104: crawl/search robot runs used to accumulate every
 * visited page in a local array and only call `serializableCallback` once, after the whole
 * page-by-page loop finished. If the run was killed/timed out/aborted mid-loop, everything
 * scraped so far was lost. These tests drive the real `Interpreter` (no mocking of the crawl/
 * search action logic itself) against a mocked Playwright `Page` backed by jsdom, and assert
 * that `serializableCallback` is invoked incrementally, once per page, with a strictly growing
 * snapshot — not once at the very end.
 */
import type { Page } from 'playwright-core';
import Interpreter from '../interpret';
import type { WorkflowFile } from '../types/workflow';

jest.setTimeout(30000);

interface MockPageOptions {
  initialUrl: string;
  /** Exact-match or startsWith-prefix map from URL to the HTML to load into jsdom's document. */
  fixtures: Record<string, string>;
  /** URLs for which page.goto() should reject (simulating a hard navigation failure). */
  failGotoUrls?: string[];
  /** URLs for which page.evaluate() should reject while the page is "on" that URL. */
  failEvaluateUrls?: string[];
}

function resolveFixture(fixtures: Record<string, string>, url: string): string {
  if (fixtures[url]) return fixtures[url];
  const prefixMatch = Object.keys(fixtures).find((k) => url.startsWith(k));
  return prefixMatch ? fixtures[prefixMatch] : '<html><body></body></html>';
}

function createMockPage(opts: MockPageOptions) {
  let currentUrl = opts.initialUrl;

  const navigateTo = (url: string) => {
    currentUrl = url;
    document.documentElement.innerHTML = resolveFixture(opts.fixtures, url);
  };

  navigateTo(opts.initialUrl);

  const page: any = {
    url: jest.fn(() => currentUrl),
    context: jest.fn(() => ({})),
    setDefaultNavigationTimeout: jest.fn(),
    isClosed: jest.fn(() => false),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    removeListener: jest.fn(),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue({}),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    addInitScript: jest.fn().mockResolvedValue(undefined),
    keyboard: { press: jest.fn().mockResolvedValue(undefined) },
    goto: jest.fn(async (url: string) => {
      if (opts.failGotoUrls?.includes(url)) {
        throw new Error(`Simulated navigation failure for ${url}`);
      }
      navigateTo(url);
      return null;
    }),
    evaluate: jest.fn((fn: any, ...args: any[]) => {
      if (opts.failEvaluateUrls?.includes(currentUrl)) {
        return Promise.reject(new Error(`Simulated evaluate failure at ${currentUrl}`));
      }
      return Promise.resolve(fn(...args));
    }),
  };

  return page;
}

function crawlWorkflow(baseUrl: string, crawlConfig: Record<string, any>): WorkflowFile {
  return {
    workflow: [
      {
        where: { url: baseUrl },
        what: [{ action: 'crawl', args: [crawlConfig] }],
      },
    ],
  };
}

/**
 * serializableCallback is invoked with the SAME mutable array reference every time (the
 * production code intentionally reuses one array/object, relying on each call being awaited
 * before the next page mutates it further — see persistCrawlProgress/persistSearchProgress in
 * interpret.ts). jest's `mock.calls` only stores that reference, so inspecting it after the run
 * finishes would show every call as the final, fully-mutated state. Deep-clone at call time
 * instead, to actually capture what was "persisted" at each point in time.
 */
function createSnapshottingCallback() {
  const snapshots: any[] = [];
  const callback = jest.fn(async (payload: any) => {
    snapshots.push(JSON.parse(JSON.stringify(payload)));
  });
  return { callback, snapshots };
}

function searchWorkflow(searchConfig: Record<string, any>): WorkflowFile {
  return {
    workflow: [
      {
        where: { url: 'https://duckduckgo.com/' },
        what: [{ action: 'search', args: [searchConfig] }],
      },
    ],
  };
}

describe('crawl action — incremental persistence', () => {
  const BASE = 'https://example.com/';
  const PAGE1 = 'https://example.com/page1';
  const PAGE2 = 'https://example.com/page2';

  const fixtures = {
    [BASE]: `<html><head><title>Home</title></head><body><a href="${PAGE1}">Page1</a></body></html>`,
    [PAGE1]: `<html><head><title>Page1</title></head><body><a href="${PAGE2}">Page2</a></body></html>`,
    [PAGE2]: '<html><head><title>Page2</title></head><body>No more links</body></html>',
  };

  const baseCrawlConfig = {
    mode: 'domain',
    limit: 3,
    maxDepth: 5,
    includePaths: [],
    excludePaths: [],
    useSitemap: false,
    followLinks: true,
    respectRobots: false,
  };

  function crawlSnapshots(snapshots: any[]): any[][] {
    return snapshots
      .map((payload) => payload?.crawl?.['Crawl Results'])
      .filter((v: any) => Array.isArray(v));
  }

  it('persists results after every page, not just once at the end', async () => {
    const { callback: serializableCallback, snapshots: rawSnapshots } = createSnapshottingCallback();
    const interpreter = new Interpreter(crawlWorkflow(BASE, baseCrawlConfig), {
      serializableCallback,
      binaryCallback: jest.fn(),
    });
    const page = createMockPage({ initialUrl: BASE, fixtures });

    await interpreter.run(page as unknown as Page);

    const snapshots = crawlSnapshots(rawSnapshots);

    // The old, buggy behavior only ever produced ONE snapshot (the full array, at the very
    // end). The fix must produce a snapshot after every page, growing by exactly one each time.
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(snapshots[0]).toHaveLength(1);
    expect(snapshots[1]).toHaveLength(2);
    expect(snapshots[snapshots.length - 1]).toHaveLength(3);

    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i].length).toBeGreaterThanOrEqual(snapshots[i - 1].length);
    }

    const finalUrls = snapshots[snapshots.length - 1].map((r: any) => r.metadata?.url);
    expect(finalUrls).toEqual(expect.arrayContaining([BASE, PAGE1, PAGE2]));
  });

  it('keeps already-scraped pages recorded when a later page fails outright (simulated kill mid-run)', async () => {
    const { callback: serializableCallback, snapshots: rawSnapshots } = createSnapshottingCallback();
    const interpreter = new Interpreter(crawlWorkflow(BASE, baseCrawlConfig), {
      serializableCallback,
      binaryCallback: jest.fn(),
    });
    const page = createMockPage({ initialUrl: BASE, fixtures, failGotoUrls: [PAGE1] });

    await expect(interpreter.run(page as unknown as Page)).resolves.toBeUndefined();

    const snapshots = crawlSnapshots(rawSnapshots);

    // A snapshot containing ONLY the first (successful) page must have been persisted before
    // the second page's failure was even known — proving the first page isn't held only in
    // memory waiting for the whole loop to finish.
    expect(snapshots.some((s) => s.length === 1 && !s[0].error && s[0].metadata?.url === BASE)).toBe(true);

    const final = snapshots[snapshots.length - 1];
    expect(final).toHaveLength(2);
    const failedEntry = final.find((r: any) => r.metadata?.url === PAGE1);
    expect(failedEntry).toBeDefined();
    expect(failedEntry.error).toBeDefined();
  });
});

describe('search action (scrape mode) — incremental persistence', () => {
  const SITE_A = 'https://site-a.example/';
  const SITE_B = 'https://site-b.example/';

  const ddgResultsHtml = `
    <html><body>
      <article data-testid="result">
        <h2><a href="${SITE_A}">Site A</a></h2>
        <div data-testid="result-snippet">Description A</div>
      </article>
      <article data-testid="result">
        <h2><a href="${SITE_B}">Site B</a></h2>
        <div data-testid="result-snippet">Description B</div>
      </article>
    </body></html>
  `;

  const fixtures = {
    'https://duckduckgo.com/': ddgResultsHtml,
    [SITE_A]: '<html><head><title>Site A Title</title></head><body>Site A body</body></html>',
    [SITE_B]: '<html><head><title>Site B Title</title></head><body>Site B body</body></html>',
  };

  const baseSearchConfig = {
    query: 'test query',
    limit: 2,
    provider: 'duckduckgo',
    mode: 'scrape',
  };

  function searchSnapshots(snapshots: any[]): any[][] {
    return snapshots
      .map((payload) => payload?.search?.['Search Results']?.results)
      .filter((v: any) => Array.isArray(v));
  }

  it('persists scraped search results after every result page, not just once at the end', async () => {
    const { callback: serializableCallback, snapshots: rawSnapshots } = createSnapshottingCallback();
    const interpreter = new Interpreter(searchWorkflow(baseSearchConfig), {
      serializableCallback,
      binaryCallback: jest.fn(),
    });
    const page = createMockPage({ initialUrl: 'https://duckduckgo.com/', fixtures });

    await interpreter.run(page as unknown as Page);

    const snapshots = searchSnapshots(rawSnapshots);

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]).toHaveLength(1);
    expect(snapshots[snapshots.length - 1]).toHaveLength(2);

    const finalUrls = snapshots[snapshots.length - 1].map((r: any) => r.metadata?.url);
    expect(finalUrls).toEqual(expect.arrayContaining([SITE_A, SITE_B]));
  });

  it('keeps the first scraped result recorded when the second result fails', async () => {
    const { callback: serializableCallback, snapshots: rawSnapshots } = createSnapshottingCallback();
    const interpreter = new Interpreter(searchWorkflow(baseSearchConfig), {
      serializableCallback,
      binaryCallback: jest.fn(),
    });
    const page = createMockPage({
      initialUrl: 'https://duckduckgo.com/',
      fixtures,
      failEvaluateUrls: [SITE_B],
    });

    await expect(interpreter.run(page as unknown as Page)).resolves.toBeUndefined();

    const snapshots = searchSnapshots(rawSnapshots);

    expect(snapshots.some((s) => s.length === 1 && !s[0].error && s[0].metadata?.url === SITE_A)).toBe(true);

    const final = snapshots[snapshots.length - 1];
    expect(final).toHaveLength(2);
    const failedEntry = final.find((r: any) => r.url === SITE_B || r.metadata?.url === SITE_B);
    expect(failedEntry).toBeDefined();
    expect(failedEntry.error).toBeDefined();
  });

  it('stops scraping further results as soon as the interpreter is aborted', async () => {
    let interpreter: Interpreter;
    const rawSnapshots: any[] = [];
    const serializableCallback = jest.fn(async (payload: any) => {
      rawSnapshots.push(JSON.parse(JSON.stringify(payload)));
      const results = payload?.search?.['Search Results']?.results;
      if (Array.isArray(results) && results.length === 1) {
        interpreter.abort();
      }
    });
    interpreter = new Interpreter(searchWorkflow(baseSearchConfig), {
      serializableCallback,
      binaryCallback: jest.fn(),
    });
    const page = createMockPage({ initialUrl: 'https://duckduckgo.com/', fixtures });

    await interpreter.run(page as unknown as Page);

    const snapshots = searchSnapshots(rawSnapshots);
    const final = snapshots[snapshots.length - 1];

    expect(final).toHaveLength(1);
    expect(final[0].metadata?.url).toBe(SITE_A);
    expect(page.goto).not.toHaveBeenCalledWith(SITE_B);
  });
});
