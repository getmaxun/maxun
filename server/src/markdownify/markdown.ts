import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'joplin-turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { isolateMainContent } from './mainContent';

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
        } catch { }
      }
      // Standard markdown for images without alt text (no invented "Image" label).
      return `![${alt.replace(/[\[\]]/g, "")}](${src})`;
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
      out = transformOutsideCode(out, (prose) => {
        prose = fixBrokenLinks(prose);
        prose = stripSkipLinks(prose);
        prose = stripEditLinks(prose);
        prose = prose.replace(/\s*\((?:opens?|opening)[^)]*\b(?:tab|window)\)/gi, "");
        return cleanupExtraWhitespace(prose);
      });
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
  return transformOutsideCode(text, (prose) => prose
    .replace(/\s*\((?:opens?|opening)[^)]*\b(?:tab|window)\)/gi, "")
    .replace(/\s*\(external link\)/gi, ""))
    .trim();
}

/** Keep Turndown's code delimiters and contents literal during prose cleanup. */
function transformOutsideCode(markdown: string, transform: (prose: string) => string): string {
  let lineStart = 0;
  let lineEnd = markdown.indexOf('\n');
  let firstMarker = true;
  const markers = Array.from(markdown.matchAll(/`+|~{3,}/g), (match) => {
    const start = match.index;
    while (lineEnd !== -1 && lineEnd < start) {
      lineStart = lineEnd + 1;
      lineEnd = markdown.indexOf('\n', lineStart);
      firstMarker = true;
    }
    const prefix = firstMarker ? markdown.slice(lineStart, start) : undefined;
    firstMarker = false;
    const end = start + match[0].length;
    const restOfLine = prefix === undefined ? '' :
      markdown.slice(end, lineEnd === -1 ? markdown.length : lineEnd);
    const containerPrefix = prefix?.replace(/>[\t ]?/g, '');
    const containerIndent = Array.from(containerPrefix || '').reduce(
      (column, char) => column + (char === '\t' ? 4 - column % 4 : 1), 0
    );
    return {
      start, end, marker: match[0],
      quoteDepth: (prefix?.match(/>/g) || []).length,
      containerIndent,
      opensFence: match[0].length >= 3 && containerPrefix !== undefined &&
        /^[\t ]*(?:(?:[-+*]|\d+[.)])[\t ]+)*$/.test(containerPrefix) &&
        (match[0][0] !== '`' || !restOfLine.includes('`')),
      closesFence: containerPrefix !== undefined && /^[\t ]*$/.test(containerPrefix) &&
        !restOfLine.trim(),
    };
  });
  const nextMatching = new Map<string, number>();
  const nextIndices: (number | undefined)[] = new Array(markers.length);
  for (let index = markers.length - 1; index >= 0; index--) {
    nextIndices[index] = nextMatching.get(markers[index].marker);
    nextMatching.set(markers[index].marker, index);
  }

  let output = '';
  let offset = 0;
  const cleanProseSegment = (start: number, end: number, followedByCode: boolean) => {
    // Code delimiters are non-whitespace, so retain that context at segment boundaries.
    const before = start > 0 ? '\uE000' : '';
    const after = followedByCode ? '\uE000' : '';
    const cleaned = transform(before + markdown.slice(start, end) + after);
    return cleaned.slice(before.length, after ? -1 : undefined);
  };
  for (let index = 0; index < markers.length; index++) {
    const opening = markers[index];
    let escapeStart = opening.start;
    while (markdown[escapeStart - 1] === '\\') escapeStart--;
    if ((opening.start - escapeStart) % 2) continue;
    if (opening.marker[0] === '~' && !opening.opensFence) continue;

    let closingIndex = nextIndices[index];
    if (opening.opensFence) {
      closingIndex = undefined;
      for (let candidate = index + 1; candidate < markers.length; candidate++) {
        const closing = markers[candidate];
        if (closing.closesFence && closing.quoteDepth === opening.quoteDepth &&
          closing.containerIndent >= opening.containerIndent &&
          closing.containerIndent <= opening.containerIndent + 3 &&
          closing.marker[0] === opening.marker[0] &&
          closing.marker.length >= opening.marker.length) {
          closingIndex = candidate;
          break;
        }
      }
    }
    if (closingIndex === undefined && !opening.opensFence) continue;
    const end = closingIndex === undefined ? markdown.length : markers[closingIndex].end;
    output += cleanProseSegment(offset, opening.start, true);
    output += markdown.slice(opening.start, end);
    offset = end;
    if (closingIndex === undefined) break;
    index = closingIndex;
  }
  return output + cleanProseSegment(offset, markdown.length, false);
}

/**
 * Unwrap common link-redirect/tracking wrappers (Microsoft SafeLinks, Google
 * /url redirects, etc.) back to the real destination URL. Generic across sites
 * and lossless — the wrapped target is recovered from the wrapper's own query
 * param, so no link is dropped, only de-obfuscated. URLSearchParams already
 * decodes that parameter; remaining escapes belong to the destination URL.
 */
function unwrapRedirect(href: string): string {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();

    if (host.endsWith("safelinks.protection.outlook.com")) {
      const target = u.searchParams.get("url");
      if (target) return target;
    }

    if (host.endsWith("google.com") && u.pathname === "/url") {
      const target = u.searchParams.get("q") || u.searchParams.get("url");
      if (target) return target;
    }

    const generic = u.searchParams.get("redirect_uri") || u.searchParams.get("redirectUrl");
    if (generic && /^https?:\/\//i.test(generic)) return generic;
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
      const escapedLatex = escapeHtml(latex);
      $el.replaceWith(isBlock ? `<p>$$${escapedLatex}$$</p>` : `<span>$${escapedLatex}$</span>`);
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

  // The page headline often sits outside the article body; remember it before
  // narrowing to the main content.
  const pageHeading = $("h1").first().text().replace(/\s+/g, " ").trim();
  const docTitle = $("title").text().replace(/\s+/g, " ").trim();

  const $content = isolateMainContent($);

  $content.find("button, span, a, div").each((_i, el) => {
    const $el = $(el);
    if ($el.parents('pre, code').length > 0) return;
    if ($el.children().length > 0) return;
    if (UI_ARTIFACTS.has($el.text().trim())) $el.remove();
  });

  let resultHtml = $content.html() || "";

  const hasHeading = $content.find("h1").length > 0 || $content.is("h1");
  const title = hasHeading ? docTitle : (pageHeading || docTitle);
  if (title && !resultHtml.includes(title) && !(hasHeading && pageHeading && docTitle.includes(pageHeading))) {
    resultHtml = `<h1>${escapeHtml(title)}</h1>\n${resultHtml}`;
  }

  return resultHtml;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
