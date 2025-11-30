import { connectToRemoteBrowser } from "../browser-management/browserConnection";
import { parseMarkdown } from "./markdown";

/**
 * Fetches a webpage, strips scripts/styles/images/etc,
 * returns clean Markdown using parser.
 */
export async function convertPageToMarkdown(url: string): Promise<string> {
  const browser = await connectToRemoteBrowser();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle", timeout: 100000 });

  await page.addInitScript(() => {
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
  });

  // Re-extract HTML after cleanup
  const cleanedHtml = await page.evaluate(() => {
    return document.documentElement.outerHTML;
  });

  await browser.close();

  // Convert cleaned HTML → Markdown
  const markdown = await parseMarkdown(cleanedHtml, url);
  return markdown;
}

/**
 * Fetches a webpage, strips scripts/styles/images/etc,
 * returns clean HTML.
 */
export async function convertPageToHTML(url: string): Promise<string> {
  const browser = await connectToRemoteBrowser();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: "networkidle", timeout: 100000 });

  await page.addInitScript(() => {
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
  });

  // Re-extract HTML after cleanup
  const cleanedHtml = await page.evaluate(() => {
    return document.documentElement.outerHTML;
  });

  await browser.close();

  // Return cleaned HTML directly
  return cleanedHtml;
}
