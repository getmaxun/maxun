/**
 * AI Extract: intent-first robot creation for one page.
 *
 *   0. scope     – the user's URL is loaded and the browser is held to that page
 *   1. reveal    – overlays closed, page scrolled, collapsed sections opened
 *   2. spec      – what the user asked for (answer shape, fields, limit)
 *   3. snapshot  – the visible page as id-tagged lines
 *   4. extract   – the model cites the line behind every value; code checks it
 *   5. compile   – the cited examples become selectors (scrapeList / scrapeSchema)
 *   6. verify    – the selectors must reproduce the examples in maxun-core's
 *                  scraper before anything is saved
 *
 * The user's prompt defines what to extract and the URL defines where. The
 * page's own structure (its lists and groups) is only used to turn the
 * extracted examples into selectors; it never decides what is extracted.
 *
 * Pagination: when the user asked for a specific number of items and the
 * page shows fewer, the robot may click the page's own next-page control
 * (see pagination.ts). Creating the robot still never leaves the page.
 *
 * The result is an ordinary robot in the recorder's format, plus the spec and
 * sample rows (saved in recording_meta.aiExtract). There is no fallback: when
 * the requested data is not on the page, the caller gets a clear reason
 * rather than a robot built from some other list or page.
 */
import fs from 'fs';
import path from 'path';
import { Page } from 'playwright-core';
import { v4 as uuid } from 'uuid';
import logger from '../../logger';
import { buildExtractionSpec, ExtractionSpec } from './spec';
import { extractGrounded, PageSnapshot } from './extract';
import { JsonLLM } from './llmClient';
import { documentKey, PageScopeGuard } from './pageScope';
import { revealPageContent, RevealReport } from './reveal';
import { detectNextPage, IN_PAGE_PAGINATION, ListPagination, NEXT_PAGE_PAGINATION } from './pagination';

export interface AiExtractMeta {
  version: 2;
  spec: ExtractionSpec;
  /** The page the robot reads (the user's URL) and where it resolved to. */
  url: string;
  resolvedUrl: string;
  /** Verified rows from creation: what a healthy run looks like. */
  samples: Record<string, string>[];
  /** Requested fields that could not be found on the page. */
  missingFields: string[];
  createdAt: string;
}

export interface AiExtractResult {
  success: boolean;
  workflow?: any[];
  aiExtract?: AiExtractMeta;
  /** Why no robot was built, phrased for the user. */
  reason?: string;
  /** Navigations that were stopped to keep extraction on the page. */
  blockedNavigations?: string[];
}

const DEFAULT_LIMIT = 100;
/** Overall LLM time for one robot. */
const DEFAULT_BUDGET_MS = 180_000;
const MIN_EXAMPLE_COVERAGE = 0.8;

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Same scale as the browser-side matcher: 1 exact, 0.75 / 0.5 containment, 0 unrelated. */
function matchScore(actual: unknown, expected: unknown): number {
  const a = norm(actual);
  const e = norm(expected);
  if (!a || !e) return 0;
  if (a === e) return 1;
  if (a.includes(e)) return 0.75;
  if (e.includes(a) && a.length >= 2) return 0.5;
  return 0;
}

/** Share of example rows that some scraped row reproduces (most of its fields matching). */
export function exampleCoverage(scraped: Record<string, any>[], examples: Record<string, string>[], fieldNames: string[]): number {
  if (examples.length === 0) return 0;
  let covered = 0;
  for (const example of examples) {
    const names = fieldNames.filter((n) => example[n] != null);
    if (names.length === 0) continue;
    const needed = Math.ceil(names.length * 0.7);
    const hit = scraped.some((row) => names.filter((n) => matchScore(row[n], example[n]) >= 0.5).length >= needed);
    if (hit) covered++;
  }
  return covered / examples.length;
}

let cachedScripts: { analyzer: string; aiExtract: string; scraper: string } | null = null;
function browserScripts() {
  if (!cachedScripts) {
    cachedScripts = {
      analyzer: fs.readFileSync(path.join(__dirname, '..', 'browserSide', 'pageAnalyzer.js'), 'utf8'),
      aiExtract: fs.readFileSync(path.join(__dirname, '..', 'browserSide', 'aiExtractPage.js'), 'utf8'),
      // The same scraper robots run with, so verification matches real runs.
      scraper: fs.readFileSync(require.resolve('maxun-core/build/browserSide/scraper.js'), 'utf8'),
    };
  }
  return cachedScripts;
}

async function injectScripts(page: Page): Promise<void> {
  const { analyzer, aiExtract, scraper } = browserScripts();
  for (const script of [analyzer, aiExtract]) {
    await page.evaluate((code: string) => { (0, eval)(code); }, script);
  }
  // The scraper declares top-level names; run it in its own function scope so
  // they cannot clash with the page's globals, and only once per document.
  await page.evaluate((code: string) => {
    if (typeof (window as any).scrapeList === 'function' && typeof (window as any).scrapeSchema === 'function') return;
    (0, eval)(`(function () {\n${code}\n})();`);
  }, scraper);
}

/** Removes the snapshot's line ids so the page is left as it was. */
async function removeSnapshotIds(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('[data-mx-aid]').forEach((el) => el.removeAttribute('data-mx-aid'));
  }).catch(() => undefined);
}

function baseWorkflow(url: string, actions: any[]): any[] {
  return [{
    where: { url, selectors: [] },
    what: [
      { action: 'goto', args: [url] },
      { action: 'waitForLoadState', args: ['networkidle'] },
      ...actions,
      { action: 'waitForLoadState', args: ['networkidle'] },
    ],
  }];
}

/**
 * Last check before a robot is returned: it loads only the user's page, and
 * its pagination either stays on that page or, for an explicit item count,
 * is next-page pagination capped at that count. Throws otherwise.
 */
export function assertWorkflowInScope(workflow: any[], url: string, options: { requestedCount?: number | null } = {}): void {
  const target = documentKey(url);
  for (const pair of workflow) {
    for (const step of pair.what || []) {
      if (step.action === 'goto' && documentKey(String(step.args?.[0] ?? '')) !== target) {
        throw new Error(`Generated robot would open ${step.args?.[0]}, which is not the extraction page`);
      }
      if (step.action === 'scrapeList') {
        const type = step.args?.[0]?.pagination?.type || 'none';
        if (IN_PAGE_PAGINATION.has(type)) continue;
        // Next-page pagination only for an explicit count, and never past it.
        const count = options.requestedCount;
        if (!NEXT_PAGE_PAGINATION.has(type) || !count || step.args?.[0]?.limit !== count) {
          throw new Error(`Generated robot uses "${type}" pagination, which would leave the extraction page`);
        }
      }
    }
  }
}

async function buildListRobot(
  page: Page,
  pageUrl: string,
  spec: ExtractionSpec,
  rows: any[],
  reveal: RevealReport,
): Promise<{ success: boolean; reason?: string; actions?: any[]; samples?: Record<string, string>[]; missingFields?: string[] }> {
  const compiled: any = await page.evaluate(
    (input: any) => (window as any).__mxAiExtract.compileList(input),
    { fields: spec.fields, rows },
  );
  if (!compiled?.candidates?.length) {
    return { success: false, reason: compiled?.error || 'Could not build selectors from the extracted examples' };
  }

  const fieldNames = spec.fields.map((f) => f.name);
  const limit = spec.limit || DEFAULT_LIMIT;

  for (const candidate of compiled.candidates) {
    const mapped = Object.keys(candidate.fields);
    if (mapped.length < Math.ceil(fieldNames.length / 2)) {
      logger.info(`[AiExtract] Candidate ${candidate.listSelector} maps only ${mapped.length}/${fieldNames.length} fields; skipping`);
      continue;
    }
    // Verify against every item on the page: a small requested count ("top 3")
    // must not hide the examples. The count only goes into the saved config.
    const verifyLimit = Math.max(limit, compiled.examples.length, candidate.itemCount || 0);
    const scraped: Record<string, any>[] = await page.evaluate(
      (cfg: any) => (window as any).scrapeList({ listSelector: cfg.listSelector, fields: cfg.fields, limit: cfg.limit }),
      { listSelector: candidate.listSelector, fields: candidate.fields, limit: verifyLimit },
    );
    const coverage = exampleCoverage(scraped, compiled.examples, mapped);
    logger.info(`[AiExtract] Candidate ${candidate.listSelector}: ${scraped.length} rows, reproduces ${Math.round(coverage * 100)}% of ${compiled.examples.length} examples`);
    if (coverage < MIN_EXAMPLE_COVERAGE || scraped.length < compiled.examples.length) continue;

    // More items than the page shows: scroll when the page loads more as it
    // scrolls; otherwise, only for an explicit count, use the page's own
    // next-page control.
    let pagination: ListPagination = { type: 'none', selector: '' };
    if (candidate.itemCount < limit) {
      if (reveal.grewOnScroll) {
        pagination = { type: 'scrollDown', selector: '' };
      } else if (spec.limit) {
        const next = await detectNextPage(page, candidate.listSelector, pageUrl);
        if (next) {
          pagination = next;
          logger.info(`[AiExtract] ${spec.limit} items requested, ${candidate.itemCount} on the page; the robot will use ${next.type} (${next.selector})`);
        } else {
          logger.warn(`[AiExtract] ${spec.limit} items requested but only ${candidate.itemCount} on the page, and no next-page control was found`);
        }
      }
    }

    const fields: Record<string, any> = {};
    for (const name of fieldNames) {
      if (candidate.fields[name]) fields[name] = candidate.fields[name];
    }

    const action = {
      action: 'scrapeList',
      actionId: `list-${uuid()}`,
      name: spec.name,
      args: [{
        fields,
        listSelector: candidate.listSelector,
        pagination,
        limit,
      }],
    };
    return {
      success: true,
      actions: [action],
      samples: scraped.slice(0, Math.min(5, limit)),
      missingFields: fieldNames.filter((n) => !fields[n]),
    };
  }
  return { success: false, reason: 'No selector reproduced the data extracted from the page' };
}

async function buildSingleRobot(
  page: Page,
  spec: ExtractionSpec,
  row: any,
): Promise<{ success: boolean; reason?: string; actions?: any[]; samples?: Record<string, string>[]; missingFields?: string[] }> {
  const compiled: any = await page.evaluate(
    (input: any) => (window as any).__mxAiExtract.compileSchema(input),
    { fields: spec.fields, values: row },
  );
  const mapped = Object.keys(compiled?.fields || {});
  if (mapped.length === 0) return { success: false, reason: 'Could not build selectors for the extracted values' };

  const scraped: Record<string, any>[] = await page.evaluate((fields: any) => (window as any).scrapeSchema(fields), compiled.fields);
  const coverage = exampleCoverage(scraped, [compiled.expected], mapped);
  logger.info(`[AiExtract] Schema selectors reproduce ${Math.round(coverage * 100)}% of the extracted values`);
  if (coverage < 1) return { success: false, reason: 'The selectors did not reproduce the values extracted from the page' };

  const action = { action: 'scrapeSchema', actionId: `text-${uuid()}`, name: spec.name, args: [compiled.fields] };
  return {
    success: true,
    actions: [action],
    samples: scraped.slice(0, 1),
    missingFields: spec.fields.map((f) => f.name).filter((n) => !compiled.fields[n]),
  };
}

function notFoundReason(spec: ExtractionSpec, url: string): string {
  const fields = spec.fields.map((f) => f.name).join(', ');
  return `The requested data (${fields}) was not found on ${url}. AI Extract only reads this page and does not visit other pages; ` +
    'check that the URL shows the data, or describe the data as it appears on the page.';
}

/**
 * Builds a robot for `prompt` from the page at `url`. Loads the page itself
 * and keeps the browser on it for the whole run. Never throws: a failure
 * returns { success: false, reason }.
 */
export async function generateAiExtractWorkflow(params: {
  page: Page;
  url: string;
  prompt: string;
  llm: JsonLLM;
  budgetMs?: number;
  /** Shorter waits for deterministic test pages. */
  revealOptions?: Parameters<typeof revealPageContent>[2];
}): Promise<AiExtractResult> {
  const { page, url, prompt, llm } = params;
  const started = Date.now();
  const deadline = started + (params.budgetMs || Number(process.env.AI_EXTRACT_BUDGET_MS) || DEFAULT_BUDGET_MS);
  const guard = new PageScopeGuard(page, url);
  try {
    const resolvedUrl = await guard.open();
    const reveal = await revealPageContent(page, guard, params.revealOptions);

    await injectScripts(page);
    const snapshot: PageSnapshot = await page.evaluate(() => (window as any).__mxAiExtract.snapshot());
    if (!snapshot?.lines?.length) return { success: false, reason: `${url} has no visible text to extract from` };

    const { spec } = await buildExtractionSpec(llm, prompt, snapshot.title, deadline);
    logger.info(`[AiExtract] Spec: ${spec.shape} "${spec.name}" with fields ${spec.fields.map((f) => `${f.name}:${f.type}`).join(', ')}${spec.limit ? `, limit ${spec.limit}` : ''}`);

    const grounded = await extractGrounded(llm, snapshot, prompt, spec, deadline);
    if (!grounded) return { success: false, reason: notFoundReason(spec, url), blockedNavigations: guard.blocked };
    logger.info(`[AiExtract] ${grounded.rows.length} grounded example(s) from chunk ${grounded.chunkIndex} via ${grounded.provider}`);

    const built = spec.shape === 'single'
      ? await buildSingleRobot(page, spec, grounded.rows[0])
      : await buildListRobot(page, resolvedUrl, spec, grounded.rows, reveal);

    // A click during extraction must not have moved the page either.
    if (!(await guard.ensureInScope())) {
      return { success: false, reason: `The page navigated away from ${url} during extraction`, blockedNavigations: guard.blocked };
    }

    if (!built.success || !built.actions) {
      logger.info(`[AiExtract] Failed in ${((Date.now() - started) / 1000).toFixed(1)}s: ${built.reason}`);
      return { success: false, reason: built.reason, blockedNavigations: guard.blocked };
    }

    const workflow = baseWorkflow(url, built.actions);
    assertWorkflowInScope(workflow, url, { requestedCount: spec.limit });

    if (built.missingFields?.length) {
      logger.warn(`[AiExtract] Not found on the page: ${built.missingFields.join(', ')}`);
    }
    logger.info(`[AiExtract] Robot built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return {
      success: true,
      workflow,
      blockedNavigations: guard.blocked,
      aiExtract: {
        version: 2,
        spec,
        url,
        resolvedUrl,
        samples: built.samples || [],
        missingFields: built.missingFields || [],
        createdAt: new Date().toISOString(),
      },
    };
  } catch (error: any) {
    logger.error('[AiExtract] Extraction failed', {
      message: error.message,
      status: error.response?.status,
      url: error.config?.url,
      method: error.config?.method,
      baseURL: error.config?.baseURL,
      response: error.response?.data,
    });
    return { success: false, reason: error?.message || String(error), blockedNavigations: guard.blocked };
  } finally {
    await removeSnapshotIds(page);
    await guard.dispose();
  }
}
