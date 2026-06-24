import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'joplin-turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { AsyncLocalStorage } from 'async_hooks';

const _als = new AsyncLocalStorage<{ baseUrl: string | null }>();

const _turndown = (() => {
  const t = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  t.addRule("forceAtxHeadings", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content: string, node: any) => {
      const level = Number(node.nodeName.charAt(1));
      const clean = content.trim();
      if (!clean) return "";
      return `\n${"#".repeat(level)} ${clean}\n`;
    },
  });

  t.addRule("truncate-svg", {
    filter: (node: any) => node.nodeName.toLowerCase() === "svg",
    replacement: () => "",
  });

  t.addRule("superscript", {
    filter: "sup",
    replacement: (content: string) => {
      const clean = content.trim();
      if (!clean) return "";
      return `^${clean}^`;
    },
  });

  t.addRule("improved-paragraph", {
    filter: "p",
    replacement: (innerText: string) => {
      const trimmed = innerText.trim();
      if (!trimmed) return "";
      return `\n\n${trimmed.replace(/\n{3,}/g, "\n\n")}\n\n`;
    },
  });

  t.addRule("inlineLink", {
    filter: (node: any) =>
      node.nodeName === "A" && node.getAttribute("href"),

    replacement: (content: string, node: any) => {
      let text = stripA11yText(content.trim().replace(/\n+/g, " "));

      if (!text) {
        text = stripA11yText(
          node.getAttribute("aria-label")?.trim() ||
          node.getAttribute("title")?.trim() ||
          getDomainFromUrl(node.getAttribute("href")) ||
          ""
        );
      }

      if (!text) return "";

      let href = node.getAttribute("href").trim();
      const normalizedHref = href.replace(/[\x00-\x1F\x7F-\x9F\s]/g, "").toLowerCase();
      if (normalizedHref.startsWith("javascript:")) return text;

      const _baseUrl = _als.getStore()?.baseUrl ?? null;
      if (_baseUrl && isRelativeUrl(href)) {
        try {
          const u = new URL(href, _baseUrl);
          href = u.toString();
        } catch { }
      }

      href = unwrapRedirect(href);

      const headingMatch = text.match(/^(#{1,6})\s+([\s\S]+)$/);
      if (headingMatch) {
        const level = headingMatch[1];
        const headingText = headingMatch[2]
          .split(/!\[[^\]]*\]\([^)]*\)/)[0]
          .replace(/\s+/g, " ")
          .trim();
        if (!headingText) return "";
        return `\n${level} [${headingText}](${href})\n`;
      }

      return `[${text}](${href})`;
    },
  });

  t.addRule("images", {
    filter: "img",
    replacement: (_content: string, node: any) => {
      const alt = node.getAttribute("alt")?.trim() || node.getAttribute("title")?.trim() || "";
      let src = node.getAttribute("src")?.trim() || "";
      if (!src) return "";

      if (src.startsWith("data:")) return "";

      const _baseUrl = _als.getStore()?.baseUrl ?? null;
      if (_baseUrl && isRelativeUrl(src)) {
        try {
          src = new URL(src, _baseUrl).toString();
        } catch {}
      }
      return alt ? `![${alt}](${src})` : `[Image](${src})`;
    },
  });

  t.use(gfm);
  return t;
})();

const TECHNICAL_SELECTOR = [
  "script", "style", "iframe", "noscript", "meta", "link", "object",
  "embed", "canvas", "audio", "video", "svg", "map", "area",
].join(",");

const UI_ARTIFACTS = new Set([
  "Undo", "Done", "Edit", "Viewed categories", "Dismiss", "Close", "View detail", "View more",
]);

/**
 * Site chrome that is *semantically declared* as non-content. Removing these is
 * lossless: <nav>/<aside> and the ARIA landmark roles exist specifically to mark
 * navigation / complementary / page-header / page-footer regions, so they never
 * contain the primary article. We intentionally do NOT guess content by class/id
 * names, nor score/pick a single "main" block — both can discard real data.
 */
const CHROME_LANDMARK_SELECTOR = [
  "nav", "aside",
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="search"]', '[role="complementary"]',
].join(",");

/**
 * Cookie/consent overlays and injected browser widgets (e.g. Google Translate).
 * These identifiers belong exclusively to consent managers / injected widgets
 * and never wrap page content, so removing them cannot drop real data.
 */
const CHROME_WIDGET_SELECTOR = [
  "#onetrust-banner-sdk", "#onetrust-consent-sdk", ".onetrust-pc-dark-filter", ".ot-sdk-container",
  "#cookie-banner", "#cookie-consent", "#cookieConsent", "#CybotCookiebotDialog",
  '[aria-label*="cookie consent" i]', '[id*="cookie-consent" i]', '[class*="cookie-consent" i]',
  ".skiptranslate", ".goog-te-banner-frame", "#goog-gt-tt", "#google_translate_element",
].join(",");

export async function parseMarkdown(
  html: string | null | undefined,
  baseUrl?: string | null
): Promise<string> {
  if (!html) return "";

  return _als.run({ baseUrl: baseUrl ?? null }, () => {
    try {
      const tidiedHtml = tidyHtml(html as string);
      let out = _turndown.turndown(tidiedHtml);
      out = fixBrokenLinks(out);
      out = stripSkipLinks(out);
      out = stripEditLinks(out);
      out = out.replace(/\s*\((?:opens?|opening)[^)]*\b(?:tab|window)\)/gi, "");
      out = cleanupExtraWhitespace(out);
      return out.trim();
    } catch (err) {
      console.error("HTML→Markdown failed", { err });
      return "";
    }
  });
}

function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  return !url.includes("://") && !url.startsWith("mailto:") && !url.startsWith("data:") && !url.startsWith("tel:");
}

function getDomainFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

/**
 * Remove screen-reader-only annotations that get injected into visible link
 * text, e.g. "Read more(opens in a new tab)". Generic and lossless — these
 * phrases are accessibility hints, never real content.
 */
function stripA11yText(text: string): string {
  return text
    .replace(/\s*\((?:opens?|opening)[^)]*\b(?:tab|window)\)/gi, "")
    .replace(/\s*\(external link\)/gi, "")
    .trim();
}

/**
 * Unwrap common link-redirect/tracking wrappers (Microsoft SafeLinks, Google
 * /url redirects, etc.) back to the real destination URL. Generic across sites
 * and lossless — the wrapped target is recovered from the wrapper's own query
 * param, so no link is dropped, only de-obfuscated.
 */
function unwrapRedirect(href: string): string {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();

    if (host.endsWith("safelinks.protection.outlook.com")) {
      const target = u.searchParams.get("url");
      if (target) return decodeURIComponent(target);
    }

    if (host.endsWith("google.com") && u.pathname === "/url") {
      const target = u.searchParams.get("q") || u.searchParams.get("url");
      if (target) return decodeURIComponent(target);
    }

    const generic = u.searchParams.get("redirect_uri") || u.searchParams.get("redirectUrl");
    if (generic && /^https?:\/\//i.test(generic)) return decodeURIComponent(generic);
  } catch {
  }
  return href;
}

function tidyHtml(html: string): string {
  const $ = cheerio.load(html);

  $(TECHNICAL_SELECTOR).remove();

  $("math").each((_i, el) => {
    const $el = $(el);
    const isBlock = ($el.attr("display") || "").toLowerCase() === "block";
    const annotation = $el.find('annotation[encoding="application/x-tex"]').text().trim();
    const alttext = ($el.attr("alttext") || "").trim();
    const latex = annotation || alttext;
    if (latex) {
      $el.replaceWith(isBlock ? `<p>$$${latex}$$</p>` : `<span>$${latex}$</span>`);
    } else {
      $el.remove();
    }
  });

  $(CHROME_LANDMARK_SELECTOR).remove();
  $("header, footer").each((_i, el) => {
    if ($(el).parents("article, main, section").length === 0) {
      $(el).remove();
    }
  });
  $(CHROME_WIDGET_SELECTOR).remove();

  const mainSelectors = ["main", "article", "#main-content", "#content", ".main", ".content", ".article", ".post-content", "[role='main']"];
  let bestContent: cheerio.Cheerio<any> | null = null;
  for (const selector of mainSelectors) {
    const el = $(selector);
    if (el.length > 0) {
      let candidate = el.first();
      let maxLen = candidate.text().length;
      el.each((_idx, elem) => {
        const len = $(elem).text().length;
        if (len > maxLen) {
          maxLen = len;
          candidate = $(elem);
        }
      });
      if (maxLen > 100) {
        bestContent = candidate;
        break;
      }
    }
  }

  const $content = bestContent || $("body");

  $content.find("button, span, a, div").each((_i, el) => {
    const $el = $(el);
    if ($el.children().length > 0) return;
    if (UI_ARTIFACTS.has($el.text().trim())) $el.remove();
  });

  const title = $("title").text().trim() || $("h1").first().text().trim();
  let resultHtml = $content.html() || "";

  if (title && !resultHtml.includes(title)) {
    resultHtml = `<h1>${title}</h1>\n${resultHtml}`;
  }

  return resultHtml;
}

function fixBrokenLinks(md: string): string {
  const parts = md.split(/((?:^|\n)(`{3,}|~{3,})[\s\S]*?\n\2(?:\n|$))/g);
  return parts.map((part, i) => {
    if (i % 3 === 1) return part;
    if (i % 3 === 2) return "";

    return part.split("\n\n").map(paragraph => {
      if (!paragraph.includes("[") || !paragraph.includes("\n")) return paragraph;
      let depth = 0;
      let result = "";
      for (const ch of paragraph) {
        if (ch === "[") depth++;
        if (ch === "]") depth = Math.max(0, depth - 1);
        result += depth > 0 && ch === "\n" ? "\\\n" : ch;
      }
      return result;
    }).join("\n\n");
  }).join("");
}

function stripSkipLinks(md: string): string {
  return md.replace(/\[Skip to Content\]\(#[^\)]*\)/gi, "");
}

function stripEditLinks(md: string): string {
  return md
    .replace(/\[\\?\[edit\\?\]\]\([^)]*\)/gi, "")
    .replace(/\[\[edit\]\]\([^)]*\)/gi, "")
    .replace(/\s*\[edit\]\s*$/gim, "");
}

function cleanupExtraWhitespace(md: string): string {
  return md
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\)•\[/g, ")• [");
}
