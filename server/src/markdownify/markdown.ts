import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'joplin-turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { isolateMainContent } from './mainContent';

const _als = new AsyncLocalStorage<{
  baseUrl: string | null;
  codeStart: string;
  codeEnd: string;
  codeBoundary: string;
}>();

const _turndown = (() => {
  const t = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    preformattedCode: true,
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
      if (node.isCode) return content;
      let text = stripA11yText(transformOutsideCode(
        content.trim(), (prose) => prose.replace(/\n+/g, " ")
      ));

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
        const headingText = transformOutsideCode(headingMatch[2], (prose) => prose
          .split(/!\[[^\]]*\]\([^)]*\)/)[0]
          .replace(/\s+/g, " ")
        ).trim();
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
  t.addRule("protectedInlineCode", {
    filter: (node: any) => node.nodeName === 'CODE' && !(
      node.parentNode?.nodeName === 'PRE' && !node.previousSibling && !node.nextSibling
    ),
    replacement: (content: string) => {
      const code = unprotectCode(content).replace(/\r\n?|\n/g, ' ');
      if (!code) return '';
      const lengths = new Set(Array.from(code.matchAll(/`+/g), (run) => run[0].length));
      let length = 1;
      while (lengths.has(length)) length++;
      const delimiter = '`'.repeat(length);
      const pad = code.startsWith('`') || code.endsWith('`') ||
        (code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) ? ' ' : '';
      return protectCode(`${delimiter}${pad}${code}${pad}${delimiter}`);
    },
  });
  t.addRule("protectedFencedCode", {
    filter: (node: any) => node.nodeName === 'PRE' && node.firstChild?.nodeName === 'CODE',
    replacement: (_content: string, node: any, options) => {
      const codeNode = node.firstChild;
      const language = /language-(\S+)/.exec(codeNode.getAttribute('class') || '')?.[1] || '';
      const code: string = codeNode.textContent;
      const marker = (options.fence || '```')[0];
      let length = 3;
      for (const run of code.matchAll(marker === '~' ? /~+/g : /`+/g)) {
        length = Math.max(length, run[0].length + 1);
      }
      const fence = marker.repeat(length);
      return `\n\n${protectCode(`${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}`)}\n\n`;
    },
  });
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

  const codeMarker = `\uE000${randomUUID()}`;
  return _als.run({
    baseUrl: baseUrl ?? null,
    codeStart: `${codeMarker}-start\uE001`,
    codeEnd: `${codeMarker}-end\uE001`,
    codeBoundary: `${codeMarker}-boundary\uE001`,
  }, () => {
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
      return unprotectCode(out).trim();
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

/** Mark code while rendering it; no Markdown delimiter inference is needed later. */
function protectCode(markdown: string): string {
  const context = _als.getStore();
  return context ? context.codeStart + markdown + context.codeEnd : markdown;
}

function unprotectCode(markdown: string): string {
  const context = _als.getStore();
  return context ? markdown.split(context.codeStart).join('').split(context.codeEnd).join('') : markdown;
}

function transformOutsideCode(markdown: string, transform: (prose: string) => string): string {
  const context = _als.getStore();
  if (!context) return transform(markdown);
  const cleanProseSegment = (start: number, end: number, followedByCode: boolean) => {
    const before = start > 0 ? context.codeBoundary : '';
    const after = followedByCode ? context.codeBoundary : '';
    return transform(before + markdown.slice(start, end) + after)
      .split(context.codeBoundary).join('');
  };
  let output = '';
  let offset = 0;
  let start = markdown.indexOf(context.codeStart);
  while (start !== -1) {
    const close = markdown.indexOf(context.codeEnd, start + context.codeStart.length);
    const end = close === -1 ? markdown.length : close + context.codeEnd.length;
    output += cleanProseSegment(offset, start, true) + markdown.slice(start, end);
    offset = end;
    start = markdown.indexOf(context.codeStart, offset);
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

  // Join unseparated inline code before choosing its Markdown delimiters.
  let codeChanged = true;
  while (codeChanged) {
    codeChanged = false;
    const $inlineCode = $content.find('code').filter((_i, el) => $(el).parents('pre, code').length === 0);
    $inlineCode.each((_i, el) => {
      let $parent = $(el).parent('span');
      while ($parent.length && $parent[0] !== $content[0] &&
        $parent.contents().filter((_index, child) => child.type !== 'comment').length === 1) {
        $parent.replaceWith($(el));
        codeChanged = true;
        $parent = $(el).parent('span');
      }
    });
    $inlineCode.each((_i, el) => {
      if (!el.parentNode) return;
      let next = el.nextSibling;
      while (next) {
        if (next.type === 'comment') {
          $(next).remove();
        } else if (next.type === 'tag' && next.name === 'code') {
          $(el).append($(next).contents());
          $(next).remove();
        } else {
          break;
        }
        codeChanged = true;
        next = el.nextSibling;
      }
    });
  }

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
