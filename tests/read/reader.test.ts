import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../../src/log.ts";
import { htmlToText } from "../../src/read/html.ts";
import { pdfToText } from "../../src/read/pdf.ts";
import { readFoundDocuments } from "../../src/read/reader.ts";
import { renderPage } from "../../src/read/render.ts";
import { openDb } from "../../src/store/db.ts";
import { addFoundDocument, listDocumentsByStatus } from "../../src/store/documents.ts";
import { addSource } from "../../src/store/sources.ts";
import type { FetchResult, Fetcher } from "../../src/watch/fetcher.ts";

const docs = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../fixtures/docs", name));
const log: Logger = { info: () => {}, warn: () => {}, error: () => {} };

describe("htmlToText", () => {
  it("keeps the news release body and drops the site navigation", () => {
    const { title, text } = htmlToText(docs("rio2-fenix-q3.html").toString("utf8"));
    expect(title).toBe("RIO2 PROVIDES FENIX GOLD Q3 OPERATIONS UPDATE");
    expect(text).toContain("The Fenix Gold Mine is in the ramp-up stage of its first year of gold production");
    expect(text).toContain("remains on track to achieve commercial production in Q4");
    expect(text).not.toContain("All News");
  });

  it("keeps paragraph breaks and writes table rows as tab-separated lines", () => {
    const html = `<html><head><title>T</title><script>var x=1</script></head><body>
      <nav>Menu item</nav><main><p>First   paragraph.</p><p>Second
      paragraph.</p><table><tr><th>Item</th><th>Value</th></tr><tr><td>Capex</td><td>US$1.2 bn</td></tr></table></main>
      <footer>Footer text</footer></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("T");
    expect(text).toContain("First paragraph.\n\nSecond paragraph.");
    expect(text).toContain("Capex\tUS$1.2 bn");
    expect(text).not.toMatch(/Menu item|Footer text|var x/);
  });
});

describe("pdfToText", () => {
  it("extracts the text of a real news-release PDF", async () => {
    const text = await pdfToText(new Uint8Array(docs("losandes-management-change.pdf")));
    expect(text).toContain("Los Andes Copper Management Change");
    // PDF text wraps lines mid-sentence.
    expect(text.replace(/\s+/g, " ")).toContain("located 150 kilometers north of Santiago");
  });
});

describe("readFoundDocuments", () => {
  it("reads found documents and marks unreachable ones failed", async () => {
    const db = openDb(":memory:");
    const sourceId = addSource(db, { url: "https://x.com/news", kind: "ir_news", company: "X" });
    const add = (url: string) => addFoundDocument(db, { url, title: "t", sourceId, projectId: null, status: "found" });
    add("https://x.com/news/fenix");
    add("https://x.com/files/release.pdf");
    add("https://x.com/news/gone");
    const fetcher: Fetcher = {
      async get(url): Promise<FetchResult> {
        if (url.endsWith("fenix")) {
          return { ok: true, url, status: 200, contentType: "text/html; charset=utf-8", body: docs("rio2-fenix-q3.html") };
        }
        if (url.endsWith(".pdf")) {
          // Some servers send PDFs as octet-stream; the extension decides then.
          return { ok: true, url, status: 200, contentType: "application/octet-stream", body: docs("losandes-management-change.pdf") };
        }
        return { ok: false, url, error: "HTTP 404" };
      },
    };
    expect(await readFoundDocuments(db, fetcher, log)).toEqual({ read: 2, failed: 1 });
    const read = listDocumentsByStatus(db, ["read"]);
    expect(read.map((d) => d.url)).toEqual(["https://x.com/news/fenix", "https://x.com/files/release.pdf"]);
    expect(read[1].text).toContain("Minister of Mines");
    // Each document keeps its own publication date: the page's metadata, or the PDF's dateline.
    const dates = db.prepare("SELECT url, published_at FROM documents WHERE status = 'read' ORDER BY id").all();
    expect(dates).toEqual([
      { url: "https://x.com/news/fenix", published_at: "2026-09-28" },
      { url: "https://x.com/files/release.pdf", published_at: "2026-01-20" },
    ]);
    const [failed] = listDocumentsByStatus(db, ["failed"]);
    expect(failed.error).toContain("404");
  });
});

describe("renderPage", () => {
  it("explains how to install playwright when it is missing", async () => {
    const missing = () => Promise.reject(new Error("Cannot find package 'playwright'"));
    await expect(renderPage("https://x.com", "UA", missing)).rejects.toThrow(
      "playwright is not installed: npm i -D playwright && npx playwright install chromium",
    );
  });
});
