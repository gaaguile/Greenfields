import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

const DROP = "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form";
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "table", "thead", "tbody", "dl", "dt", "dd", "figure", "figcaption",
]);

const squash = (s: string) => s.replace(/\s+/g, " ");

export function htmlToText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = squash($("title").first().text()).trim() || squash($("h1").first().text()).trim();
  $(DROP).remove();
  // Prefer the article, then main, then body; fall back to the whole document.
  const root = ["article", "main", "body"].map((sel) => $(sel).first()).find((c) => c.length);
  const scope: AnyNode[] = root ? root.toArray() : $.root().toArray();

  const out: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      out.push(squash((node as unknown as { data: string }).data));
      return;
    }
    if (node.type !== "tag") return;
    const tag = node.name.toLowerCase();
    if (tag === "br") { out.push("\n"); return; }
    if (tag === "tr") {
      const cells = $(node).children("td, th").map((_, c) => squash($(c).text()).trim()).get();
      out.push("\n" + cells.join("\t") + "\n");
      return;
    }
    const block = BLOCK.has(tag);
    if (block) out.push("\n\n");
    for (const child of node.children) walk(child);
    if (block) out.push("\n\n");
  };
  for (const el of scope) walk(el);

  const text = out
    .join("")
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}
