import { connectToRemoteBrowser } from "../browser-management/browserConnection";
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
export async function convertPageToMarkdown(url: string): Promise<string> {
  const browser = await connectToRemoteBrowser();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle", timeout: 100000 });

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
export async function convertPageToHTML(url: string): Promise<string> {
  const browser = await connectToRemoteBrowser();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle", timeout: 100000 });

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
