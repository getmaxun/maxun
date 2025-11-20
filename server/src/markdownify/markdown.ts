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

  const t = new TurndownService();

  t.addRule("truncate-svg", {
    filter: "svg",
    replacement: () => "",
  });

  t.addRule("improved-paragraph", {
    filter: "p",
    replacement: (innerText: string) => {
      const trimmed = innerText.trim();
      if (!trimmed) return "";
      return `${trimmed.replace(/\n{3,}/g, "\n\n")}\n\n`;
    },
  });

  t.addRule("inlineLink", {
    filter: (node: any, opts: any) =>
      opts.linkStyle === "inlined" &&
      node.nodeName === "A" &&
      node.getAttribute("href"),

    replacement: (content: string, node: any) => {
      let href = node.getAttribute("href").trim();

      // Relative → absolute
      if (baseUrl && isRelativeUrl(href)) {
        try {
          const u = new URL(href, baseUrl);
          href = u.toString();
        } catch {}
      }

      // Clean URL
      href = cleanUrl(href);

      const title = node.title ? ` "${cleanAttribute(node.title)}"` : "";
      return `[${content.trim()}](${href}${title})\n`;
    },
  });

  t.use(gfm);

  // ---------------------------------------------------
  // Convert
  // ---------------------------------------------------
  try {
    let out = await t.turndown(tidiedHtml);
    out = fixBrokenLinks(out);
    out = stripSkipLinks(out);
    return out;
  } catch (err) {
    console.error("HTML→Markdown failed", { err });
    return "";
  }
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function isRelativeUrl(url: string): boolean {
  return !url.includes("://") && !url.startsWith("mailto:") && !url.startsWith("tel:");
}

function cleanUrl(u: string): string {
  try {
    return u;
  } catch {
    return u;
  }
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
  "video"
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
