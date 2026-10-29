import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../../src/log.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import { openDb } from "../../src/store/db.ts";
import { listDocumentsByStatus } from "../../src/store/documents.ts";
import { addSource, listSources } from "../../src/store/sources.ts";
import type { FetchResult, Fetcher } from "../../src/watch/fetcher.ts";
import { watchSources } from "../../src/watch/watcher.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));
const NEWS_URL = "https://losandescopper.com/news/";
const basePage = readFileSync(path.resolve(import.meta.dirname, "../fixtures/pages/losandescopper-news.html"), "utf8");
const NEW_ITEM = "https://losandescopper.com/news/2026/los-andes-copper-files-updated-feasibility-study/";
// The saved page is minified without a <body> tag, so the new item is appended.
const withNewItem =
  basePage +
  `<main><a href="/news/2026/los-andes-copper-files-updated-feasibility-study/">Los Andes Copper files updated feasibility study</a></main>`;

function quietLog() {
  const lines: string[] = [];
  const log: Logger = { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
  return { log, lines };
}

function fakeFetcher(pages: Map<string, string | null>): Fetcher {
  return {
    async get(url): Promise<FetchResult> {
      const html = pages.get(url);
      if (html == null) return { ok: false, url, error: "HTTP 503" };
      return { ok: true, url, status: 200, contentType: "text/html", body: new TextEncoder().encode(html) };
    },
  };
}

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  addSource(db, { url: NEWS_URL, kind: "ir_news", projectSlug: "vizcachitas" });
  return db;
}

describe("watchSources", () => {
  it("stores every link as a skipped baseline on a source's first check", async () => {
    const db = setup();
    const { log } = quietLog();
    const r = await watchSources(db, fakeFetcher(new Map([[NEWS_URL, basePage]])), listSources(db), log, "2026-10-01T00:00:00Z");
    expect(r).toEqual({ checked: 1, newDocuments: 0, failed: 0 });
    expect(listDocumentsByStatus(db, ["found"])).toHaveLength(0);
    expect(listDocumentsByStatus(db, ["skipped"]).length).toBeGreaterThan(5);
    expect(listSources(db)[0].firstCheckedAt).toBe("2026-10-01T00:00:00Z");
  });

  it("stores only links that appear after the first check, with the source's project", async () => {
    const db = setup();
    const { log } = quietLog();
    await watchSources(db, fakeFetcher(new Map([[NEWS_URL, basePage]])), listSources(db), log, "2026-10-01T00:00:00Z");
    const r = await watchSources(db, fakeFetcher(new Map([[NEWS_URL, withNewItem]])), listSources(db), log, "2026-10-02T00:00:00Z");
    expect(r.newDocuments).toBe(1);
    const found = listDocumentsByStatus(db, ["found"]);
    expect(found.map((d) => d.url)).toEqual([NEW_ITEM]);
    expect(found[0].projectId).toBe(listSources(db)[0].projectId);
    expect(found[0].title).toBe("Los Andes Copper files updated feasibility study");
  });

  it("adds nothing when the page's links are unchanged", async () => {
    const db = setup();
    const { log } = quietLog();
    const f = fakeFetcher(new Map([[NEWS_URL, basePage]]));
    await watchSources(db, f, listSources(db), log, "2026-10-01T00:00:00Z");
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n;
    const before = count();
    expect((await watchSources(db, f, listSources(db), log, "2026-10-02T00:00:00Z")).newDocuments).toBe(0);
    expect(count()).toBe(before);
    expect(listSources(db)[0].lastCheckedAt).toBe("2026-10-02T00:00:00Z");
  });

  it("records a fetch failure without throwing", async () => {
    const db = setup();
    const { log } = quietLog();
    const r = await watchSources(db, fakeFetcher(new Map([[NEWS_URL, null]])), listSources(db), log, "2026-10-01T00:00:00Z");
    expect(r).toEqual({ checked: 1, newDocuments: 0, failed: 1 });
    expect(listSources(db)[0]).toMatchObject({ failureCount: 1, lastError: "HTTP 503" });
  });

  it("skips a source that needs rendering when no renderer is given, logging it once", async () => {
    const db = setup();
    addSource(db, { url: "https://newmont.com/news", kind: "ir_news", company: "Newmont", render: true });
    const { log, lines } = quietLog();
    const r = await watchSources(db, fakeFetcher(new Map([[NEWS_URL, basePage]])), listSources(db), log, "2026-10-01T00:00:00Z");
    expect(r.checked).toBe(1);
    expect(lines.filter((l) => l.includes("render"))).toHaveLength(1);
  });

  it("uses the renderer for a source marked render", async () => {
    const db = openDb(":memory:");
    addSource(db, { url: "https://newmont.com/news", kind: "ir_news", company: "Newmont", render: true });
    const { log } = quietLog();
    const rendered: string[] = [];
    const render = async (url: string) => { rendered.push(url); return basePage; };
    const r = await watchSources(db, fakeFetcher(new Map()), listSources(db), log, "2026-10-01T00:00:00Z", { render });
    expect(rendered).toEqual(["https://newmont.com/news"]);
    expect(r.failed).toBe(0);
  });
});

describe("watchSources baseline safety", () => {
  const listing = (n: number) =>
    "<main>" + Array.from({ length: n }, (_, i) => `<a href="/news/2019/old-item-number-${i}">Old news item number ${i}</a>`).join("") + "</main>";

  it("keeps the baseline for later when the first check finds no links", async () => {
    const db = setup();
    const { log } = quietLog();
    await watchSources(db, fakeFetcher(new Map([[NEWS_URL, "<main>Loading…</main>"]])), listSources(db), log, "2026-10-01T00:00:00Z");
    expect(listSources(db)[0].firstCheckedAt).toBeNull();
    const r = await watchSources(db, fakeFetcher(new Map([[NEWS_URL, listing(20)]])), listSources(db), log, "2026-10-02T00:00:00Z");
    expect(r.newDocuments).toBe(0);
    expect(listDocumentsByStatus(db, ["skipped"])).toHaveLength(20);
  });

  it("treats a burst of more than 15 new links as a new baseline and flags the source", async () => {
    const db = setup();
    const { log } = quietLog();
    await watchSources(db, fakeFetcher(new Map([[NEWS_URL, basePage]])), listSources(db), log, "2026-10-01T00:00:00Z");
    const r = await watchSources(db, fakeFetcher(new Map([[NEWS_URL, listing(16)]])), listSources(db), log, "2026-10-02T00:00:00Z");
    expect(r.newDocuments).toBe(0);
    expect(listDocumentsByStatus(db, ["found"])).toHaveLength(0);
    expect(listSources(db)[0].health).toBe("changed");
  });
});
