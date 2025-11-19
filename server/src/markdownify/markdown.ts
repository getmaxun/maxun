export async function parseMarkdown(
  html: string | null | undefined,
  baseUrl?: string | null
): Promise<string> {
  const TurndownService = require("turndown");
  const { gfm } = require("joplin-turndown-plugin-gfm");
  const { URL } = require('url');

  const t = new TurndownService();
  t.addRule("inlineLink", {
    filter: (node: any, opts: any) =>
      opts.linkStyle === "inlined" &&
      node.nodeName === "A" &&
      node.getAttribute("href"),
    replacement: (content: string, node: any) => {
      let href = node.getAttribute("href").trim();
      
      // Convert relative URLs to absolute if baseUrl is provided
      if (baseUrl && isRelativeUrl(href)) {
        try {
          const url = new URL(href, baseUrl);
          href = url.toString();
        } catch (err) {
          // If URL construction fails, keep the original href
        }
      }
      
      const title = node.title ? ` "${node.title}"` : "";
      return `[${content.trim()}](${href}${title})\n`;
    },
  });

  t.use(gfm);

  try {
    let out = await t.turndown(html);
    out = fixBrokenLinks(out);
    out = stripSkipLinks(out);
    return out;
  } catch (err) {
    console.error("HTML→Markdown failed", { err });
    return "";
  }
}

function isRelativeUrl(url: string): boolean {
  return !url.includes('://') && !url.startsWith('mailto:') && !url.startsWith('tel:');
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function fixBrokenLinks(md: string): string {
  let depth = 0;
  let result = "";

  for (const ch of md) {
    if (ch === "[") depth++;
    if (ch === "]") depth = Math.max(0, depth - 1);

    if (depth > 0 && ch === "\n") {
      result += "\\\n";
    } else {
      result += ch;
    }
  }
  return result;
}

function stripSkipLinks(md: string): string {
  return md.replace(/\[Skip to Content\]\(#[^\)]*\)/gi, "");
}


