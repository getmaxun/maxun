import { Page } from "playwright-core";
import { parseMarkdown } from "./markdown";
import logger from "../logger";

async function waitForStability(page: Page): Promise<void> {
  try {
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}),
      page.evaluate(async () => {
        let lastLen = 0;
        let stableIterations = 0;
        for (let i = 0; i < 60; i++) {
          const currentLen = document.body?.innerText?.length ?? 0;
          if (currentLen > 200 && currentLen === lastLen) {
            stableIterations++;
          } else {
            stableIterations = 0;
          }
          if (stableIterations >= 8) return true;
          lastLen = currentLen;
          await new Promise(r => setTimeout(r, 100));
        }
        return false;
      }).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 10000))
    ]);
    await new Promise(resolve => setTimeout(resolve, 1500));
  } catch {}
}

async function dismissOverlays(page: Page): Promise<void> {
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise(r => setTimeout(r, 400));

    const clicked = await page.evaluate(() => {
      function isVisible(el: Element): boolean {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const s = window.getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
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
          if (isVisible(el)) {
            (el as HTMLElement).click();
            return true;
          }
        }
      }

      const CLOSE_LABELS = new Set(['×', '✕', '✖', 'x', 'X', 'Close', 'close', '关闭', 'Dismiss', 'dismiss', 'Got it', '知道了', '我知道了']);
      for (const el of Array.from(document.querySelectorAll('button, [role="button"]'))) {
        const text = ((el as HTMLElement).innerText || '').trim();
        const label = (el.getAttribute('aria-label') || '').trim();
        if ((CLOSE_LABELS.has(text) || CLOSE_LABELS.has(label)) && isVisible(el)) {
          (el as HTMLElement).click();
          return true;
        }
      }

      return false;
    }).catch(() => false);

    if (clicked) {
      await new Promise(r => setTimeout(r, 700));
    }
  } catch {}
}

async function gotoWithFallback(page: any, url: string, forScreenshot = false) {
  try {
    const current = page.url();
    if (current && current !== 'about:blank') {
      const normalise = (u: string) => u.split('#')[0].split('?')[0].replace(/\/$/, '');
      if (normalise(current) === normalise(url)) return;
    }
  } catch {}

  const waitUntil = forScreenshot ? 'load' : 'domcontentloaded';
  try {
    return await page.goto(url, { waitUntil, timeout: 60000 });
  } catch (err) {
    return await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
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

    await gotoWithFallback(page, url);
    await waitForStability(page);
    await dismissOverlays(page);

    const cleanedHtml = await page.evaluate(() => {
      function flattenShadowRoots(root: Element | ShadowRoot) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        const shadowHosts: Element[] = [];
        let node: Node | null = walker.currentNode;
        while (node) {
          if (node instanceof Element && node.shadowRoot) {
            shadowHosts.push(node);
          }
          node = walker.nextNode();
        }
        for (const host of shadowHosts) {
          let visibleText = '';
          const sr = host.shadowRoot!;

          const digitEls = sr.querySelectorAll('[part*="digit"]');
          if (digitEls.length > 0) {
            const extractDigits = (container: Element | null): string => {
              if (!container) return '';
              const digits = container.querySelectorAll('[part*="digit"]');
              let result = '';
              digits.forEach(d => {
                const style = d.getAttribute('style') || '';
                const m = style.match(/--current:\s*(\d+)/);
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

          if (!visibleText) {
            visibleText = host.getAttribute('aria-label')?.trim() || '';
          }

          if (!visibleText) {
            visibleText = (host as HTMLElement).innerText?.trim() || '';
          }

          if (!visibleText) {
            visibleText = host.shadowRoot?.textContent?.trim() || '';
          }

          if (visibleText) {
            const span = document.createElement('span');
            span.textContent = visibleText;
            host.parentNode?.insertBefore(span, host);
          }
          host.remove();
        }
      }
      flattenShadowRoots(document.documentElement);

      const selectors = [
        "script",
        "style",
        "link[rel='stylesheet']",
        "noscript",
        "meta",
        "iframe",
        "object",
        "embed",
        "input[type='hidden']"
      ];

      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(e => e.remove());
      });

      const all = document.querySelectorAll("*");
      all.forEach(el => {
        [...el.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (name.startsWith("on") || name === "data-mx-id" || name === "jsaction" || name === "jsname") {
            el.removeAttribute(attr.name);
          }
        });
      });

      return document.documentElement.outerHTML;
    });

    const markdown = await parseMarkdown(cleanedHtml, url);
    return markdown;
  } catch (error: any) {
    logger.error(`[Scrape] Error during markdown conversion: ${error.message}`);
    throw error;
  }
}

/**
 * Fetches a webpage, strips scripts/styles/images/etc,
 * returns clean HTML.
 * @param url - The URL to convert
 * @param page - Existing Playwright page instance to use
 */
export async function convertPageToHTML(url: string, page: Page): Promise<string> {
  try {
    logger.log('info', `[Scrape] Using existing page instance for HTML conversion of ${url}`);

    await gotoWithFallback(page, url);
    await waitForStability(page);
    await dismissOverlays(page);

    const cleanedHtml = await page.evaluate(() => {
      function flattenShadowRoots(root: Element | ShadowRoot) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        const shadowHosts: Element[] = [];
        let node: Node | null = walker.currentNode;
        while (node) {
          if (node instanceof Element && node.shadowRoot) {
            shadowHosts.push(node);
          }
          node = walker.nextNode();
        }
        for (const host of shadowHosts) {
          let visibleText = '';
          const sr = host.shadowRoot!;
          const digitEls = sr.querySelectorAll('[part*="digit"]');
          if (digitEls.length > 0) {
            const extractDigits = (container: Element | null): string => {
              if (!container) return '';
              const digits = container.querySelectorAll('[part*="digit"]');
              let result = '';
              digits.forEach(d => {
                const style = d.getAttribute('style') || '';
                const m = style.match(/--current:\s*(\d+)/);
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
          if (!visibleText) visibleText = host.shadowRoot?.textContent?.trim() || '';
          if (visibleText) {
            const span = document.createElement('span');
            span.textContent = visibleText;
            host.parentNode?.insertBefore(span, host);
          }
          host.remove();
        }
      }
      flattenShadowRoots(document.documentElement);

      const selectors = [
        "script",
        "style",
        "link[rel='stylesheet']",
        "noscript",
        "meta",
        "iframe",
        "object",
        "embed",
        "input[type='hidden']"
      ];

      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(e => e.remove());
      });

      const all = document.querySelectorAll("*");
      all.forEach(el => {
        [...el.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (name.startsWith("on") || name === "data-mx-id" || name === "jsaction" || name === "jsname") {
            el.removeAttribute(attr.name);
          }
        });
      });

      return document.documentElement.outerHTML;
    });

    return cleanedHtml;
  } catch (error: any) {
    logger.error(`[Scrape] Error during HTML conversion: ${error.message}`);
    throw error;
  }
}

export async function convertPageToText(url: string, page: Page): Promise<string> {
  try {
    logger.log('info', `[Scrape] Using existing page instance for text conversion of ${url}`);

    await gotoWithFallback(page, url);
    await waitForStability(page);
    await dismissOverlays(page);

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
 * Extracts all HTTP/HTTPS links from the page.
 * @param url - The URL to extract links from
 * @param page - Existing Playwright page instance to use
 */
export async function convertPageToLinks(url: string, page: Page): Promise<string[]> {
  try {
    logger.log('info', `Extracting links from ${url}`);

    await gotoWithFallback(page, url);
    await waitForStability(page);
    await dismissOverlays(page);

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith('http'))
    );

    return links;
  } catch (error: any) {
    logger.error(`Error during links extraction: ${error.message}`);
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
    await waitForStability(page);
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
