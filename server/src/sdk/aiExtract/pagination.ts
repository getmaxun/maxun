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
      let elements: Element[] = [];
      try {
        elements = Array.from(document.querySelectorAll(part.trim()));
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
 * Requires pageAnalyzer.js in the page.
 */
export async function detectNextPage(page: Page, listSelector: string, pageUrl: string): Promise<ListPagination | null> {
  const detected: any = await page.evaluate((selector: string) => {
    const win = window as any;
    return typeof win.autoDetectPagination === 'function' ? win.autoDetectPagination(selector) : null;
  }, listSelector).catch(() => null);
  // Scrolling back keeps the page as the reveal step left it.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);

  if (!detected?.type || !NEXT_PAGE_PAGINATION.has(detected.type) || !detected.selector) return null;
  if (!(await controlStaysOnSite(page, detected.selector, pageUrl))) {
    logger.info(`[AiExtract] Ignoring pagination control ${detected.selector}: it is missing or leads to another site`);
    return null;
  }
  return { type: detected.type, selector: detected.selector };
}
