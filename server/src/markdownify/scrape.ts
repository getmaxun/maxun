import { Page } from "playwright-core";
import { parseMarkdown } from "./markdown";
import logger from "../logger";
import { isBackgroundRequest } from "../utils/backgroundRequests";

interface PageState {
  /** Open XHR/fetch requests that can carry page data. */
  pending: number;
  /** URL the page was last made ready for (wait + overlay dismissal). */
  readyFor?: string;
  /** Cleaned DOM snapshot shared by the markdown and HTML formats. */
  snapshot?: { url: string; html: Promise<string> };
}

const pageStates = new WeakMap<Page, PageState>();

/** Analytics, ads and chat widgets never carry page content and may never finish. */
const isDataRequest = (req: any) => {
  const type = req.resourceType();
  return (type === 'xhr' || type === 'fetch') && !isBackgroundRequest(req.url());
};

function ensurePageState(page: Page): PageState {
  const existing = pageStates.get(page);
  if (existing) return existing;
  const state: PageState = { pending: 0 };
  const tracked = new WeakSet<object>();
  pageStates.set(page, state);
  page.on('request', (req) => {
    if (!isDataRequest(req)) return;
    tracked.add(req);
    state.pending++;
  });
  const done = (req: any) => {
    if (!tracked.has(req)) return;
    tracked.delete(req);    
    state.pending = Math.max(0, state.pending - 1);
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  // Any main-frame navigation invalidates readiness and the cached snapshot.
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    state.readyFor = undefined;
    state.snapshot = undefined;
  });
  return state;
}

const idle = (page: Page, timeout: number) =>
  page.evaluate((t) => new Promise<void>((resolve) => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => resolve(), { timeout: t });
    } else {
      setTimeout(resolve, Math.min(t, 300));
    }
  }), timeout).catch(() => {});


async function waitForPageReady(page: Page): Promise<void> {
  try {
    const state = ensurePageState(page);
    await idle(page, 3000);

    const deadline = Date.now() + 8000;
    while (state.pending > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    await idle(page, 2000);
  } catch {}
}

async function dismissOverlays(page: Page): Promise<void> {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise(r => setTimeout(r, 150));

    const clicked = await page.evaluate(() => {
      function isVisible(el: Element): boolean {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      }

      // A disabled control ignores click(), and a control covered by another
      // layer would take a click meant for the foreground pop-up. Skip both so
      // a usable close control later in the list still gets tried.
      function isClickable(el: Element): boolean {
        // Selectors often match an icon inside the real control (e.g. a span
        // with pointer-events: none); judge the enclosing control instead.
        const control = el.closest('button, [role="button"], a, input, summary') || el;
        if ((control as HTMLButtonElement).disabled || control.getAttribute('aria-disabled') === 'true') return false;
        const r = control.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        // elementFromPoint only answers inside the viewport; don't reject what it can't test.
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return true;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === control || control.contains(hit));
      }

      // Only buttons inside a pop-up layer may be clicked. A bare "×" or
      // "Close" button elsewhere is page content (a removable filter chip, a
      // calculator row, a tab) and clicking it changes what gets scraped.
      function inOverlay(el: Element): boolean {
        const vw = window.innerWidth, vh = window.innerHeight;
        for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
          const role = n.getAttribute('role');
          if (role === 'dialog' || role === 'alertdialog' || n.getAttribute('aria-modal') === 'true') return true;
          if (n.tagName === 'DIALOG' && (n as HTMLDialogElement).open) return true;
          if (window.getComputedStyle(n).position === 'fixed') {
            // A fixed layer counts when it covers the page: it blocks the
            // viewport centre or a large share of it. Thin fixed bars and
            // sidebars are layout, not something to close.
            const r = n.getBoundingClientRect();
            const blocksCentre = r.left <= vw / 2 && r.right >= vw / 2 && r.top <= vh / 2 && r.bottom >= vh / 2;
            const area = (Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))) / (vw * vh || 1);
            const hinted = /modal|popup|pop-up|dialog|overlay|lightbox|newsletter|cookie|consent/i.test(String((n as HTMLElement).className || '') + ' ' + (n.id || ''));
            if (blocksCentre || area > 0.3 || hinted) return true;
            // A non-qualifying fixed element (e.g. a corner close button or a thin
            // toolbar) may still sit inside a dialog, so keep walking up.
          }
        }
        return false;
      }

      const SELECTORS = [
        '[role="dialog"] [aria-label*="close" i]',
        '[role="dialog"] [aria-label*="关闭"]',
        '[role="alertdialog"] [aria-label*="close" i]',
        '[role="alertdialog"] button',
        '[class*="modal" i] [class*="close" i]',
        '[class*="popup" i] [class*="close" i]',
        '[class*="dialog" i] [class*="close" i]',
        '[class*="overlay" i] [class*="close" i]',
        '[class*="modal" i] [class*="dismiss" i]',
        'button[aria-label*="close" i]',
        'button[aria-label*="关闭"]',
        'button[class*="close" i]',
        '.close-button', '.btn-close', '.modal__close',
      ];

      for (const sel of SELECTORS) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          if (isVisible(el) && inOverlay(el) && isClickable(el)) {
            (el as HTMLElement).click();
            return true;
          }
        }
      }

      const CLOSE_LABELS = new Set(['×', '✕', '✖', 'x', 'X', 'Close', 'close', '关闭', 'Dismiss', 'dismiss', 'Got it', '知道了', '我知道了']);
      for (const el of Array.from(document.querySelectorAll('button, [role="button"]'))) {
        const text = ((el as HTMLElement).innerText || '').trim();
        const label = (el.getAttribute('aria-label') || '').trim();
        if ((CLOSE_LABELS.has(text) || CLOSE_LABELS.has(label)) && isVisible(el) && inOverlay(el) && isClickable(el)) {
          (el as HTMLElement).click();
          return true;
        }
      }

      return false;
    }).catch(() => false);

    if (clicked) {
      // Give close animations a moment, then settle on the next idle frame.
      await new Promise(r => setTimeout(r, 300));
      await page.evaluate(() => new Promise<void>((resolve) => {
        if ('requestIdleCallback' in window) (window as any).requestIdleCallback(() => resolve(), { timeout: 400 });
        else setTimeout(resolve, 100);
      })).catch(() => {});
    }
  } catch {}
}

/**
 * Wait for the page to settle and dismiss overlays once per URL. Every format
 * (text, links, markdown, html) goes through here, so a run asking for several
 * formats pays the wait once instead of once per format.
 */
async function preparePage(page: Page, url: string): Promise<void> {
  await gotoWithFallback(page, url);
  const state = ensurePageState(page);
  const key = normaliseUrl(page.url() || url);
  if (state.readyFor === key) return;
  await waitForPageReady(page);
  await dismissOverlays(page);
  state.readyFor = normaliseUrl(page.url() || url);
}

const lastRequestedTarget = new WeakMap<object, string>();

const normaliseUrl = (u: string) => u.split('#')[0].replace(/\/$/, '');

async function gotoWithFallback(page: any, url: string, forScreenshot = false) {
  try {
    const current = page.url();
    if (current && current !== 'about:blank') {
      const normalise = (u: string) => u.split('#')[0].split('?')[0].replace(/\/$/, '');
      if (normalise(current) === normalise(url)) return;
    }
  } catch {}
  lastRequestedTarget.set(page, normaliseUrl(url));

  const waitUntil = forScreenshot ? 'load' : 'domcontentloaded';
  let response;
  try {
    response = await page.goto(url, { waitUntil, timeout: 30000 });
  } catch (err) {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  if (response && response.status() >= 500) {
    logger.log('warn', `[Scrape] ${url} returned HTTP ${response.status()}, retrying navigation once`);
    await new Promise(r => setTimeout(r, 2500));
    try {
      const retryResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return retryResponse;
    } catch {
      return response;
    }
  }
  return response;
}

/**
 * Serialise a cleaned copy of the document: shadow roots flattened to their
 * visible text, scripts/styles/embeds dropped, inline handlers stripped.
 *
 * Works on a clone so the live page keeps its styles and scripts. Earlier this
 * cleanup ran on the live DOM, which left later screenshots unstyled and broke
 * the page for the prompt agent that runs after scraping.
 */
function snapshotCleanHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const live = document.documentElement;
    const clone = live.cloneNode(true) as Element;

    // Clone and live tree have identical structure, so walk them in lockstep
    // to pair each shadow host with its copy. Text is read from the live
    // (rendered) host, the replacement is made in the clone.
    const liveWalker = document.createTreeWalker(live, NodeFilter.SHOW_ELEMENT);
    const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
    const hosts: Array<[Element, Element]> = [];
    let l: Node | null = liveWalker.currentNode;
    let c: Node | null = cloneWalker.currentNode;
    while (l && c) {
      if ((l as Element).shadowRoot) hosts.push([l as Element, c as Element]);
      l = liveWalker.nextNode();
      c = cloneWalker.nextNode();
    }

    for (const [host, copy] of hosts) {
      let visibleText = '';
      const sr = host.shadowRoot!;
      if (sr.querySelector('[part*="digit"]')) {
        const extractDigits = (container: Element | null): string => {
          if (!container) return '';
          let result = '';
          container.querySelectorAll('[part*="digit"]').forEach(d => {
            const m = (d.getAttribute('style') || '').match(/--current:\s*(\d+)/);
            if (m) result += m[1];
          });
          return result;
        };
        const intPart = extractDigits(sr.querySelector('[part="integer"]'));
        const fracPart = extractDigits(sr.querySelector('[part="fraction"]'));
        if (intPart || fracPart) {
          visibleText = fracPart ? `${intPart || '0'}.${fracPart}` : (intPart || '0');
        }
      }
      if (!visibleText) visibleText = host.getAttribute('aria-label')?.trim() || '';
      if (!visibleText) visibleText = (host as HTMLElement).innerText?.trim() || '';
      if (!visibleText) visibleText = sr.textContent?.trim() || '';

      if (visibleText) {
        const span = document.createElement('span');
        span.textContent = visibleText;
        copy.parentNode?.insertBefore(span, copy);
      }
      copy.remove();
    }

    clone.querySelectorAll(
      "script, style, link[rel='stylesheet'], noscript, meta, iframe, object, embed, input[type='hidden']"
    ).forEach(e => e.remove());

    clone.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'data-mx-id' || name === 'jsaction' || name === 'jsname') {
          el.removeAttribute(attr.name);
        }
      }
    });

    return clone.outerHTML;
  });
}

/** One cleaned snapshot per page+URL, shared by the markdown and HTML formats. */
async function getCleanHtml(page: Page, url: string): Promise<string> {
  await preparePage(page, url);
  const state = ensurePageState(page);
  const key = normaliseUrl(page.url() || url);
  if (!state.snapshot || state.snapshot.url !== key) {
    const html = snapshotCleanHtml(page);
    state.snapshot = { url: key, html };
    html.catch(() => {
      if (state.snapshot?.html === html) state.snapshot = undefined;
    });
  }
  return state.snapshot.html;
}

/**
 * Fetches a webpage, strips scripts/styles/images/etc,
 * returns clean Markdown using parser.
 * @param url - The URL to convert
 * @param page - Existing Playwright page instance to use
 */
export async function convertPageToMarkdown(url: string, page: Page): Promise<string> {
  try {
    logger.log('info', `[Scrape] Using existing page instance for markdown conversion of ${url}`);
    const cleanedHtml = await getCleanHtml(page, url);
    return await parseMarkdown(cleanedHtml, page.url() || url);
  } catch (error: any) {
    logger.error(`[Scrape] Error during markdown conversion: ${error.message}`);
    throw error;
  }
}

/**
 * Fetches a webpage, strips scripts/styles/etc, returns clean HTML.
 * @param url - The URL to convert
 * @param page - Existing Playwright page instance to use
 */
export async function convertPageToHTML(url: string, page: Page): Promise<string> {
  try {
    logger.log('info', `[Scrape] Using existing page instance for HTML conversion of ${url}`);
    return await getCleanHtml(page, url);
  } catch (error: any) {
    logger.error(`[Scrape] Error during HTML conversion: ${error.message}`);
    throw error;
  }
}

export async function convertPageToText(url: string, page: Page): Promise<string> {
  try {
    logger.log('info', `[Scrape] Using existing page instance for text conversion of ${url}`);
    await preparePage(page, url);

    const text = await page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      return body.innerText || body.textContent || '';
    });

    return text ? text.trim() : '';
  } catch (error: any) {
    logger.error(`[Scrape] Error during text conversion: ${error.message}`);
    throw error;
  }
}

/**
 * Returns the page's absolute http(s) links, de-duplicated in document order.
 * @param url - The URL to read
 * @param page - Existing Playwright page instance to use
 */
export async function convertPageToLinks(url: string, page: Page): Promise<string[]> {
  try {
    logger.log('info', `[Scrape] Extracting links from ${url}`);
    await preparePage(page, url);

    return await page.evaluate(() => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = (a as HTMLAnchorElement).href;
        if (!href.startsWith('http') || seen.has(href)) continue;
        seen.add(href);
        out.push(href);
      }
      return out;
    });
  } catch (error: any) {
    logger.error(`[Scrape] Error during links extraction: ${error.message}`);
    throw error;
  }
}

/**
 * Takes a screenshot of the page
 * @param url - The URL to screenshot
 * @param page - Existing Playwright page instance to use
 * @param fullPage - Whether to capture the full scrollable page (true) or just visible viewport (false)
 */
export async function convertPageToScreenshot(url: string, page: Page, fullPage: boolean = false): Promise<Buffer> {
  try {
    const screenshotType = fullPage ? 'full page' : 'visible viewport';
    logger.log('info', `[Scrape] Taking ${screenshotType} screenshot of ${url}`);

    await gotoWithFallback(page, url, true);
    // Skip the settle wait if another format already waited on this URL.
    if (ensurePageState(page).readyFor !== normaliseUrl(page.url() || url)) {
      await waitForPageReady(page);
    }
    await page.waitForFunction(
      () => Array.from(document.images).every(img => img.complete),
      { timeout: 5000 }
    ).catch(() => {});

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage
    });

    return screenshot;
  } catch (error: any) {
    logger.error(`[Scrape] Error during screenshot: ${error.message}`);
    throw error;
  }
}
