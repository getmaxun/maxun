/**
 * Next-page pagination for AI Extract list robots.
 *
 * AI Extract reads the page the user entered. The one exception: when the
 * user asked for a specific number of items and the page shows fewer, the
 * robot may use the page's own "Next" / "Load more" control to keep reading
 * the same list, and stops once it has that many items.
 *
 * Creating the robot never follows the control; the guard still blocks every
 * navigation. Detection only reads the page, and a control whose link points
 * to another site is refused. Other links (items, sidebar, canonical) are
 * never followed by the robot either: it only clicks the pagination control.
 */
import { Page } from 'playwright-core';
import logger from '../../logger';

export type ListPagination = { type: 'none' | 'scrollDown' | 'clickNext' | 'clickLoadMore'; selector: string };

/** Pagination types that stay on the page. */
export const IN_PAGE_PAGINATION = new Set(['none', 'scrollDown']);
/** Pagination types that may load the list's next page. */
export const NEXT_PAGE_PAGINATION = new Set(['clickNext', 'clickLoadMore']);

/**
 * Whether the control matched by `selector` is safe to click at run time:
 * it exists, and any link it is part of stays on `pageUrl`'s site.
 */
async function controlStaysOnSite(page: Page, selector: string, pageUrl: string): Promise<boolean> {
  return page.evaluate(({ selector, pageUrl }) => {
    const site = (u: string) => {
      try {
        const url = new URL(u, document.baseURI);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return null;
      }
    };
    const home = site(pageUrl);
    let found = 0;
    for (const part of selector.split(',')) {
      const sel = part.trim();
      let elements: Element[] = [];
      try {
        if (sel.startsWith('//') || sel.startsWith('(')) {
          const snap = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < snap.snapshotLength; i++) elements.push(snap.snapshotItem(i) as Element);
        } else {
          elements = Array.from(document.querySelectorAll(sel));
        }
      } catch {
        continue;
      }
      for (const el of elements) {
        found++;
        const link = el.closest('a[href]') as HTMLAnchorElement | null;
        if (!link) continue;
        const raw = link.getAttribute('href') || '';
        if (raw.startsWith('#') || /^javascript:/i.test(raw)) continue;
        if (site(link.href) !== home) return false;
      }
    }
    return found > 0;
  }, { selector, pageUrl });
}

/**
 * The page's next-page control for the list at `listSelector`, or null.
 * Tries AI Extract's own finder (rel=next, "Next"/"Load more" labels with or
 * without arrows, the link after the current page number), then the generic
 * detector. Requires pageAnalyzer.js and aiExtractPage.js in the page.
 */
export async function detectNextPage(page: Page, listSelector: string, pageUrl: string): Promise<ListPagination | null> {
  const found: any = await page.evaluate(
    (selector: string) => (window as any).__mxAiExtract.findNextPageControl(selector),
    listSelector,
  ).catch((error) => ({ reason: `finder failed: ${error?.message || error}` }));

  const accept = async (candidate: { type: string; selector: string; how: string }): Promise<ListPagination | null> => {
    if (await controlStaysOnSite(page, candidate.selector, pageUrl)) {
      logger.info(`[AiExtract] Next-page control via ${candidate.how}: ${candidate.type} ${candidate.selector}`);
      return { type: candidate.type as ListPagination['type'], selector: candidate.selector };
    }
    logger.info(`[AiExtract] Ignoring pagination control ${candidate.selector} (${candidate.how}): it is missing or leads to another site`);
    return null;
  };

  if (found?.selector) {
    const accepted = await accept({ type: found.type, selector: found.selector, how: `${found.how} "${found.label}"` });
    if (accepted) return accepted;
  } else {
    logger.info(`[AiExtract] Next-page finder: ${found?.reason || 'nothing found'}`);
  }

  const generic: any = await page.evaluate((selector: string) => {
    const win = window as any;
    return typeof win.autoDetectPagination === 'function' ? win.autoDetectPagination(selector) : null;
  }, listSelector).catch(() => null);
  // The generic detector scrolls controls into view; scroll back.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  if (generic?.type && NEXT_PAGE_PAGINATION.has(generic.type) && generic.selector) {
    return accept({ type: generic.type, selector: generic.selector, how: 'generic detector' });
  }
  logger.info(`[AiExtract] Generic pagination detector: ${generic?.type ? `found ${generic.type}, not a next-page control` : 'nothing found'}`);
  return null;
}
