import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'joplin-turndown-plugin-gfm';
import * as cheerio from 'cheerio';
import { URL } from 'url';

export async function parseMarkdown(
  html: string | null | undefined,
  baseUrl?: string | null
): Promise<string> {
  if (!html) return "";

  const tidiedHtml = tidyHtml(html);

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
      let text = content.trim().replace(/\n+/g, " ");

      if (!text) {
        text =
          node.getAttribute("aria-label")?.trim() ||
          node.getAttribute("title")?.trim() ||
          getDomainFromUrl(node.getAttribute("href")) ||
          "";
      }

      if (!text) return "";

      let href = node.getAttribute("href").trim();
      if (href.startsWith("javascript:")) return text;

      if (baseUrl && isRelativeUrl(href)) {
        try {
          const u = new URL(href, baseUrl);
          href = u.toString();
        } catch { }
      }

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

      if (baseUrl && isRelativeUrl(src)) {
        try {
          src = new URL(src, baseUrl).toString();
        } catch {}
      }
      return alt ? `![${alt}](${src})` : `[Image](${src})`;
    },
  });

  t.use(gfm);

  try {
    let out = t.turndown(tidiedHtml);
    out = fixBrokenLinks(out);
    out = stripSkipLinks(out);
    out = stripEditLinks(out);
    out = cleanupExtraWhitespace(out);
    return out.trim();
  } catch (err) {
    console.error("HTML→Markdown failed", { err });
    return "";
  }
}

function isRelativeUrl(url: string): boolean {
  if (!url) return false;
  return !url.includes("://") && !url.startsWith("mailto:") && !url.startsWith("tel:") && !url.startsWith("data:");
}

function getDomainFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

function tidyHtml(html: string): string {
  const $ = cheerio.load(html);

  const technicalElements = [
    "script", "style", "iframe", "noscript", "meta", "link", "object",
    "embed", "canvas", "audio", "video", "svg", "map", "area"
  ];
  technicalElements.forEach((tag) => $(tag).remove());

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

  $("body > header, body > footer, body > nav, body > aside").remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();

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

  const innerNoiseSelectors = [
    "nav", "footer",
    ".nav", ".header", ".footer", ".sidebar", ".menu", ".ads", ".ad", ".advertisement",
    "#nav", "#header", "#footer", "#sidebar", ".breadcrumb", ".social-share",
    ".comments", ".popup", ".modal", ".cookie-banner", ".location-widget",
    ".keyboard-shortcuts", ".skip-link", ".banner", ".top-bar", ".nav-bar",
    '[role="complementary"]',
    "#shortcut-menu", ".nav-sprite", ".a-header", ".a-footer",
    ".gb_wa", ".gb_xa",
    "#nav-belt", "#nav-main", "#nav-footer",
    ".mw-editsection", ".mw-editsection-bracket", ".mw-editsection-divider",
  ];
  innerNoiseSelectors.forEach((sel) => $content.find(sel).remove());

  const uiArtifacts = ["Undo", "Done", "Edit", "Viewed categories", "Dismiss", "Close", "View detail", "View more"];
  $content.find("button, span, a, div").each((_i, el) => {
    const text = $(el).text().trim();
    if (uiArtifacts.includes(text) && $(el).children().length === 0) {
      $(el).remove();
    }
  });

  const title = $("title").text().trim() || $("h1").first().text().trim();
  let resultHtml = $content.html() || "";

  if (title && !resultHtml.includes(title)) {
    resultHtml = `<h1>${title}</h1>\n${resultHtml}`;
  }

  return resultHtml;
}

function fixBrokenLinks(md: string): string {
  const parts = md.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    
    return part.split("\n\n").map(paragraph => {
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
    .replace(/[ \t]+\n/g, "\n");
}
