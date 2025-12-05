import { Page } from "playwright-core";
import { parseMarkdown } from "./markdown";
import logger from "../logger";

async function gotoWithFallback(page: any, url: string) {
  try {
    return await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 100000,
    });
  } catch (err) {
    // fallback: JS-heavy or unstable sites
    return await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 100000,
    });
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
      const selectors = [
        "script",
        "style",
        "link[rel='stylesheet']",
        "noscript",
        "meta",
        "svg",
        "img",
        "picture",
        "source",
        "video",
        "audio",
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
          if (attr.name.startsWith("on")) {
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
      const selectors = [
        "script",
        "style",
        "link[rel='stylesheet']",
        "noscript",
        "meta",
        "svg",
        "img",
        "picture",
        "source",
        "video",
        "audio",
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
          if (attr.name.startsWith("on")) {
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

    await gotoWithFallback(page, url);

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
