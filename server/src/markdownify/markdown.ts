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

  // Remove irrelevant tags 
  const elementsToRemove = [
    "meta",
    "style",
    "script",
    "noscript",
    "link",
    "textarea",
  ];

  t.addRule("remove-irrelevant", {
    filter: elementsToRemove,
    replacement: () => "",
  });

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

// CODE 1: attribute cleaner
function cleanAttribute(attr: string) {
  return attr ? attr.replace(/(\n+\s*)+/g, "\n") : "";
}

// ---------------------------------------------------------
// CODE 1: Full tidyHtml cleaning logic (ported verbatim)
// ---------------------------------------------------------
function tidyHtml(html: string): string {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);

  // Fix broken attributes
  $("*").each(function (this: any) {
    const element = $(this);
    const attributes = Object.keys(this.attribs);

    for (let i = 0; i < attributes.length; i++) {
      let attr = attributes[i];
      if (attr.includes('"')) {
        element.remove();
      }
    }
  });

  const manuallyCleanedElements = [
    "aside",
    "embed",
    "head",
    "iframe",
    "menu",
    "object",
    "script",
    "applet",
    "audio",
    "canvas",
    "map",
    "svg",
    "video",
    "area",
    "blink",
    "datalist",
    "dialog",
    "frame",
    "frameset",
    "link",
    "input",
    "ins",
    "legend",
    "marquee",
    "math",
    "menuitem",
    "nav",
    "noscript",
    "optgroup",
    "output",
    "param",
    "progress",
    "rp",
    "rt",
    "rtc",
    "source",
    "style",
    "track",
    "textarea",
    "time",
    "use",
    "img",
    "picture",
    "figure",
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
