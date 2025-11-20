export async function parseMarkdown(
  html: string | null | undefined,
  baseUrl?: string | null
): Promise<string> {
  const TurndownService = require("turndown");
  const { gfm } = require("joplin-turndown-plugin-gfm");
  const cheerio = require("cheerio");
  const { URL } = require("url");

  if (!html) return "";

  const tidiedHtml = tidyHtml(html);

  const t = new TurndownService({
    headingStyle: "atx", // ensures #### instead of ------
    codeBlockStyle: "fenced",
  });

  // ---------------------------------------------
  // Proper ATX headings #### instead of underline-style
  // ---------------------------------------------
  t.addRule("forceAtxHeadings", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content: string, node: any) => {
      const level = Number(node.nodeName.charAt(1));
      const clean = content.trim();
      return `\n${"#".repeat(level)} ${clean}\n`;
    },
  });

  // ---------------------------------------------
  // Remove SVGs
  // ---------------------------------------------
  t.addRule("truncate-svg", {
    filter: "svg",
    replacement: () => "",
  });

  // ---------------------------------------------
  // Improved paragraph cleanup
  // ---------------------------------------------
  t.addRule("improved-paragraph", {
    filter: "p",
    replacement: (innerText: string) => {
      const trimmed = innerText.trim();
      if (!trimmed) return "";
      return `${trimmed.replace(/\n{3,}/g, "\n\n")}\n\n`;
    },
  });

  // ---------------------------------------------
  // Inline link with fallback text
  // ---------------------------------------------
  t.addRule("inlineLink", {
    filter: (node: any, opts: any) =>
      node.nodeName === "A" && node.getAttribute("href"),

    replacement: (content: string, node: any) => {
      let text = content.trim();

      // Fallback: aria-label → title → domain
      if (!text) {
        text =
          node.getAttribute("aria-label")?.trim() ||
          node.getAttribute("title")?.trim() ||
          getDomainFromUrl(node.getAttribute("href")) ||
          "link";
      }

      let href = node.getAttribute("href").trim();

      // relative → absolute
      if (baseUrl && isRelativeUrl(href)) {
        try {
          const u = new URL(href, baseUrl);
          href = u.toString();
        } catch { }
      }

      href = cleanUrl(href);

      return `[${text}](${href})`;
    },
  });

  t.use(gfm);

  // Convert HTML → Markdown
  try {
    let out = await t.turndown(tidiedHtml);
    out = fixBrokenLinks(out);
    out = stripSkipLinks(out);
    return out.trim();
  } catch (err) {
    console.error("HTML→Markdown failed", { err });
    return "";
  }
}

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------
function isRelativeUrl(url: string): boolean {
  return !url.includes("://") && !url.startsWith("mailto:") && !url.startsWith("tel:");
}

function getDomainFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

function cleanUrl(u: string): string {
  return u;
}

function cleanAttribute(attr: string) {
  return attr ? attr.replace(/(\n+\s*)+/g, "\n") : "";
}

function tidyHtml(html: string): string {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);

  const manuallyCleanedElements = [
    "script",
    "style",
    "iframe",
    "noscript",
    "meta",
    "link",
    "object",
    "embed",
    "canvas",
    "audio",
    "video",
  ];

  manuallyCleanedElements.forEach((tag) => $(tag).remove());
  return $("body").html();
}

function fixBrokenLinks(md: string): string {
  let depth = 0;
  let result = "";

  for (const ch of md) {
    if (ch === "[") depth++;
    if (ch === "]") depth = Math.max(0, depth - 1);
    result += depth > 0 && ch === "\n" ? "\\\n" : ch;
  }
  return result;
}

function stripSkipLinks(md: string): string {
  return md.replace(/\[Skip to Content\]\(#[^\)]*\)/gi, "");
}
