import { chromium, Page } from "playwright";
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
 * @param existingPage - Optional existing Playwright page instance to reuse
 */
export async function convertPageToMarkdown(url: string, existingPage?: Page): Promise<string> {
  let browser: any = null;
  let page: Page;
  let shouldCloseBrowser = false;

  if (existingPage) {
    logger.log('info', `[Scrape] Reusing existing Playwright page instance for markdown conversion of ${url}`);
    page = existingPage;
  } else {
    logger.log('info', `[Scrape] Creating new Chromium browser instance for markdown conversion of ${url}`);
    browser = await chromium.launch();
    page = await browser.newPage();
    shouldCloseBrowser = true;
  }

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

    // Remove inline event handlers (onclick, onload…)
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

  if (shouldCloseBrowser && browser) {
    logger.log('info', `[Scrape] Closing browser instance created for markdown conversion`);
    await browser.close();
  } else {
    logger.log('info', `[Scrape] Keeping existing browser instance open after markdown conversion`);
  }

  // Convert cleaned HTML → Markdown
  const markdown = await parseMarkdown(cleanedHtml, url);
  return markdown;
}

/**
 * Fetches a webpage, strips scripts/styles/images/etc,
 * returns clean HTML.
 * @param url - The URL to convert
 * @param existingPage - Optional existing Playwright page instance to reuse
 */
export async function convertPageToHTML(url: string, existingPage?: Page): Promise<string> {
  let browser: any = null;
  let page: Page;
  let shouldCloseBrowser = false;

  if (existingPage) {
    logger.log('info', `[Scrape] Reusing existing Playwright page instance for HTML conversion of ${url}`);
    page = existingPage;
  } else {
    logger.log('info', `[Scrape] Creating new Chromium browser instance for HTML conversion of ${url}`);
    browser = await chromium.launch();
    page = await browser.newPage();
    shouldCloseBrowser = true;
  }

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

    // Remove inline event handlers (onclick, onload…)
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

  if (shouldCloseBrowser && browser) {
    logger.log('info', `[Scrape] Closing browser instance created for HTML conversion`);
    await browser.close();
  } else {
    logger.log('info', `[Scrape] Keeping existing browser instance open after HTML conversion`);
  }

  // Return cleaned HTML directly
  return cleanedHtml;
}
