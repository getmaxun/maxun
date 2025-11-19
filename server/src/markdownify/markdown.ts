import koffi from "koffi";
import dotenv from "dotenv";
import { stat } from "fs/promises";
import path from "node:path";
import os from "node:os";

const exts = {
  win32: ".dll",
  darwin: ".dylib",
  default: ".so",
};

const ext =
  exts[os.platform() as keyof typeof exts] || exts.default;

// Build path to the binary **inside the same folder**
export const GO_MARKDOWN_PARSER_PATH = path.join(
  __dirname,
  `html-to-markdown${ext}`
);

dotenv.config();

// ---------------------------------------------
// Native Go binding wrapper
// ---------------------------------------------
class NativeMarkdownBridge {
  private static singleton: NativeMarkdownBridge;
  private fnConvert: any;

  private constructor() {
    const lib = koffi.load(GO_MARKDOWN_PARSER_PATH);

    const freeFn = lib.func("FreeCString", "void", ["string"]);
    const trackedType = "CString:" + crypto.randomUUID();
    const autoReleasedStr = koffi.disposable(trackedType, "string", freeFn);

    this.fnConvert = lib.func("ConvertHTMLToMarkdown", autoReleasedStr, [
      "string",
    ]);
  }

  static async load(): Promise<NativeMarkdownBridge> {
    if (!NativeMarkdownBridge.singleton) {
      try {
        await stat(GO_MARKDOWN_PARSER_PATH);
      } catch {
        throw new Error("Go shared library not found");
      }
      NativeMarkdownBridge.singleton = new NativeMarkdownBridge();
    }
    return NativeMarkdownBridge.singleton;
  }

  async run(html: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.fnConvert.async(html, (err: Error, output: string) => {
        err ? reject(err) : resolve(output);
      });
    });
  }
}

// ---------------------------------------------
// Main exposed function
// ---------------------------------------------
export async function parseMarkdown(
  html: string | null | undefined,
): Promise<string> {
  if (!html) return "";

  // Try Go library first (if enabled)
  try {
      const engine = await NativeMarkdownBridge.load();
      let md = await engine.run(html);

      md = fixBrokenLinks(md);
      md = stripSkipLinks(md);

      return md;
  } catch (err: any) {
    if (err?.message !== "Go shared library not found") {
        console.log("Go markdown parser failed, falling back to JS parser:", err);
    } else {
      console.log("Go parser missing.", { GO_MARKDOWN_PARSER_PATH });
    }
  }

  // Fallback parser
  const TurndownService = require("turndown");
  const { gfm } = require("joplin-turndown-plugin-gfm");

  const t = new TurndownService();
  t.addRule("inlineLink", {
    filter: (node: any, opts: any) =>
      opts.linkStyle === "inlined" &&
      node.nodeName === "A" &&
      node.getAttribute("href"),
    replacement: (content: string, node: any) => {
      const href = node.getAttribute("href").trim();
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
