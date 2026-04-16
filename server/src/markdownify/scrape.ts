import { Page } from "playwright-core";
import { parseMarkdown } from "./markdown";
import logger from "../logger";

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
        "embed"
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
        "embed"
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
