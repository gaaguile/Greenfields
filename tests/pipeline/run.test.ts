import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QuotaExceededError, type ModelProvider } from "../../src/ai/provider.ts";
import { loadConfig } from "../../src/config.ts";
import type { Logger } from "../../src/log.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import { runPipeline, type PipelineDeps } from "../../src/pipeline/run.ts";
import type { Deployer } from "../../src/publish/publisher.ts";
import { openDb } from "../../src/store/db.ts";
import { addFoundDocument, listDocumentsByStatus, setDocumentStatus } from "../../src/store/documents.ts";
import { getPublished } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { addSource, listSources } from "../../src/store/sources.ts";
import type { FetchResult, Fetcher } from "../../src/watch/fetcher.ts";
import { watchSources } from "../../src/watch/watcher.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));
const basePage = readFileSync(path.resolve(import.meta.dirname, "../fixtures/pages/losandescopper-news.html"), "utf8");
const NEWS_URL = "https://losandescopper.com/news/";
const ITEM_URL = "https://losandescopper.com/news/2026/los-andes-copper-reports-new-grade/";
const pageWithItem = basePage + `<main><a href="/news/2026/los-andes-copper-reports-new-grade/">Los Andes Copper reports new grade estimate</a></main>`;
const ITEM_HTML = "<html><head><title>New grade</title></head><body><main><p>Los Andes Copper reports that the average " +
  "grade of the Vizcachitas reserve is 0.41% copper equivalent.</p></main></body></html>";
const NOW = new Date("2026-10-28T14:00:00.000Z");
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const triageReply = JSON.stringify({ projectSlug: "vizcachitas", category: "resource", material: true, possibleNewProject: false, reason: "grade" });
const gradeFigure = {
  field: "grade", valueText: "0.41% CuEq", valueNum: null, unit: null, basis: "100%", attributableShare: null,
  figureDate: null, confidence: 0.9, quote: "average grade of the Vizcachitas reserve is 0.41% copper equivalent",
};
const extractReply = (figures: object[] = [gradeFigure]) => JSON.stringify({ figures });

function provider(reply: (n: number) => string): ModelProvider & { calls: number } {
  const p = { name: "fake", calls: 0, async chatJson() { return reply(p.calls++); } };
  return p;
}

function fetcherFor(pages: Record<string, string>, fetched: string[] = []): Fetcher {
  return {
    async get(url): Promise<FetchResult> {
      fetched.push(url);
      const html = pages[url];
      if (html === undefined) return { ok: false, url, error: "HTTP 404" };
      return { ok: true, url, status: 200, contentType: "text/html", body: new TextEncoder().encode(html) };
    },
  };
}

async function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  addSource(db, { url: NEWS_URL, kind: "ir_news", projectSlug: "vizcachitas" });
  // A first check has already recorded the page's existing links.
  await watchSources(db, fetcherFor({ [NEWS_URL]: basePage }), listSources(db), silent, "2026-10-27T00:00:00Z");
  const cfg = { ...loadConfig({}), siteOutDir: mkdtempSync(path.join(os.tmpdir(), "gf-run-")) };
  const deploys: string[] = [];
  const deploy: Deployer = async (dir) => { deploys.push(dir); };
  const viz = listProjects(db).find((p) => p.slug === "vizcachitas")!;
  return { db, cfg, deploys, deploy, viz };
}

function deps(over: Partial<PipelineDeps> & Pick<PipelineDeps, "deploy">): PipelineDeps {
  return {
    fetcher: fetcherFor({ [NEWS_URL]: pageWithItem, [ITEM_URL]: ITEM_HTML }),
    providers: { triage: provider(() => triageReply), extract: provider(() => extractReply()) },
    log: silent,
    now: () => NOW,
    ...over,
  };
}

const runRows = (db: ReturnType<typeof openDb>) =>
  db.prepare("SELECT * FROM runs ORDER BY id").all() as { trigger: string; ended_at: string | null; published: number; counts: string; errors: string }[];

describe("runPipeline", () => {
  it("takes a new link through read, triage, extraction and publish", async () => {
    const { db, cfg, deploy, deploys, viz } = await setup();
    const summary = await runPipeline(db, cfg, deps({ deploy }), { trigger: "manual" });
    expect(summary.counts).toMatchObject({ newDocuments: 1, read: 1, triaged: 1, extracted: 1, published: 1, held: 0, failed: 0 });
    expect(summary.errors).toEqual([]);
    expect(summary.deployed).toBe(true);
    expect(deploys).toHaveLength(1);
    expect(getPublished(db, viz.id).find((v) => v.field === "grade")!.valueText).toBe("0.41% CuEq");
    const [run] = runRows(db);
    expect(run).toMatchObject({ trigger: "manual", published: 1 });
    expect(run.ended_at).not.toBeNull();
    expect(JSON.parse(run.counts)).toMatchObject({ published: 1 });
    expect(listDocumentsByStatus(db, ["done"]).map((d) => d.url)).toContain(ITEM_URL);
  });

  it("resumes a document left at triaged by an earlier run without fetching it again", async () => {
    const { db, cfg, deploy, viz } = await setup();
    const sourceId = listSources(db)[0].id;
    const id = addFoundDocument(db, { url: ITEM_URL, title: "t", sourceId, projectId: viz.id, status: "found" })!;
    setDocumentStatus(db, id, "triaged", { text: "Los Andes Copper reports that the average grade of the Vizcachitas reserve is 0.41% copper equivalent.", triage: triageReply });
    const fetched: string[] = [];
    const summary = await runPipeline(db, cfg, deps({ deploy, fetcher: fetcherFor({ [NEWS_URL]: basePage }, fetched) }), { trigger: "catch-up" });
    expect(fetched).not.toContain(ITEM_URL);
    expect(summary.counts).toMatchObject({ extracted: 1, published: 1 });
  });

  it("leaves documents triaged when the extraction quota runs out", async () => {
    const { db, cfg, deploy, viz } = await setup();
    const sourceId = listSources(db)[0].id;
    for (const n of [1, 2, 3]) {
      const id = addFoundDocument(db, { url: `${ITEM_URL}${n}`, title: "t", sourceId, projectId: viz.id, status: "found" })!;
      setDocumentStatus(db, id, "triaged", { text: "Some text about the project and nothing else.", triage: triageReply });
    }
    const extract = provider((n) => {
      if (n === 0) return extractReply([]);
      throw new QuotaExceededError("workersAi: daily free allocation used up");
    });
    const summary = await runPipeline(db, cfg, deps({ deploy, fetcher: fetcherFor({ [NEWS_URL]: basePage }), providers: { triage: provider(() => triageReply), extract } }), { trigger: "schedule" });
    expect(summary.errors).toEqual([]);
    expect(summary.counts.extracted).toBe(1);
    expect(listDocumentsByStatus(db, ["triaged"]).map((d) => d.url)).toEqual([`${ITEM_URL}2`, `${ITEM_URL}3`]);
  });

  it("publishes and deploys once when run twice over the same pages", async () => {
    const { db, cfg, deploy, deploys } = await setup();
    await runPipeline(db, cfg, deps({ deploy }), { trigger: "schedule" });
    const second = await runPipeline(db, cfg, deps({ deploy }), { trigger: "schedule" });
    expect(second.counts).toMatchObject({ newDocuments: 0, published: 0 });
    expect(second.deployed).toBe(false);
    expect(deploys).toHaveLength(1);
  });

  it("records a deploy failure and still finishes the run", async () => {
    const { db, cfg } = await setup();
    const failing: Deployer = async () => { throw new Error("wrangler exited with code 1"); };
    const summary = await runPipeline(db, cfg, deps({ deploy: failing }), { trigger: "schedule" });
    expect(summary.errors.join(" ")).toContain("wrangler exited with code 1");
    expect(summary.deployed).toBe(false);
    expect(runRows(db)[0].ended_at).not.toBeNull();
  });

  it("does not deploy in a dry run", async () => {
    const { db, cfg, deploy, deploys } = await setup();
    const summary = await runPipeline(db, cfg, deps({ deploy }), { trigger: "manual", dryRun: true });
    expect(summary.counts.published).toBe(1);
    expect(deploys).toHaveLength(0);
  });
});

describe("runPipeline gaming guard", () => {
  it("uses the fallback provider for triage when the GPU stays busy until the next slot", async () => {
    const { db, cfg, deploy } = await setup();
    const local = provider(() => triageReply);
    const fallback = provider(() => triageReply);
    const sleeps: number[] = [];
    const summary = await runPipeline(db, cfg, deps({
      deploy,
      providers: { triage: local, extract: provider(() => extractReply()) },
      gamingGuard: {
        probe: async () => ({ gpuPercent: 97 }),
        sleep: async (ms) => { sleeps.push(ms); },
        deadline: new Date(NOW.getTime() + 10 * 60_000),
        fallback,
      },
    }), { trigger: "schedule" });
    expect(local.calls).toBe(0);
    expect(fallback.calls).toBe(1);
    expect(summary.counts.published).toBe(1);
    expect(runRows(db)[0]).toMatchObject({ postponed: 1 });
  });
});
