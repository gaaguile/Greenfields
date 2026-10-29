import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dateFromHtml, dateFromText, dateFromUrl, documentDate } from "../../src/read/dates.ts";
import { pdfToText } from "../../src/read/pdf.ts";

const docs = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../fixtures/docs", name));
const NOW = new Date("2026-10-29T12:00:00Z");

describe("dateFromHtml", () => {
  it("reads the article's published time from a real news page", () => {
    expect(dateFromHtml(docs("rio2-fenix-q3.html").toString("utf8"), NOW)).toBe("2026-09-28");
  });

  it("reads JSON-LD datePublished and <time datetime>", () => {
    expect(dateFromHtml('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-05-04T10:00:00-04:00"}</script>', NOW)).toBe("2026-05-04");
    expect(dateFromHtml('<main><time datetime="2026-03-12">12 Mar</time></main>', NOW)).toBe("2026-03-12");
    expect(dateFromHtml("<main><p>No date here</p></main>", NOW)).toBeNull();
  });
});

describe("dateFromText", () => {
  it("finds the dateline near the top of a release", async () => {
    const text = await pdfToText(new Uint8Array(docs("losandes-management-change.pdf")));
    expect(dateFromText(text, NOW)).toBe("2026-01-20");
    expect(dateFromText("For Immediate Release\nSeptember 28, 2026 VANCOUVER, BC - Rio2", NOW)).toBe("2026-09-28");
  });

  it("reads Spanish and day-first dates", () => {
    expect(dateFromText("Santiago, 20 de enero de 2026. Codelco informó", NOW)).toBe("2026-01-20");
    expect(dateFromText("Toronto, 3 March 2026 – Company X", NOW)).toBe("2026-03-03");
  });

  it("ignores dates far down the document and dates in the future", () => {
    expect(dateFromText(`${"x ".repeat(500)} January 5, 2026`, NOW)).toBeNull();
    expect(dateFromText("Results to be released on December 15, 2026", NOW)).toBeNull();
  });
});

describe("dateFromUrl", () => {
  it("reads year/month/day paths only", () => {
    expect(dateFromUrl("https://energiminas.com/2026/08/27/chile-y-argentina")).toBe("2026-08-27");
    expect(dateFromUrl("https://www.reporteminero.cl/noticia/noticias/2026/03/lundin")).toBeNull();
    expect(dateFromUrl("https://www.sernageomin.cl/")).toBeNull();
  });
});

describe("documentDate", () => {
  it("prefers page metadata, then the dateline, then the address", () => {
    expect(documentDate({ html: '<meta property="article:published_time" content="2026-09-28T12:59:02Z">', text: "May 1, 2026", url: "https://x.com/2025/01/01/a" }, NOW)).toBe("2026-09-28");
    expect(documentDate({ html: null, text: "May 1, 2026 – News", url: "https://x.com/2025/01/01/a" }, NOW)).toBe("2026-05-01");
    expect(documentDate({ html: null, text: "no date", url: "https://x.com/2025/01/01/a" }, NOW)).toBe("2025-01-01");
    expect(documentDate({ html: null, text: null, url: "https://x.com/news" }, NOW)).toBeNull();
  });
});
