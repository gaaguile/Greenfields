import { describe, expect, it } from "vitest";
import { addFoundDocument, setDocumentStatus } from "../../src/store/documents.ts";
import { finishRun, startRun } from "../../src/store/runs.ts";
import { addSource, recordCheck } from "../../src/store/sources.ts";
import { adminApp } from "./helpers.ts";

async function withHistory() {
  const h = await adminApp();
  const { db } = h;
  const r1 = startRun(db, "schedule", "2026-10-28T07:00:00.000Z");
  finishRun(db, r1, { counts: { checked: 8, published: 1 }, errors: [], postponed: false, published: true, at: "2026-10-28T07:04:00.000Z" });
  const r2 = startRun(db, "catch-up", "2026-10-28T14:00:00.000Z");
  finishRun(db, r2, { counts: { checked: 8 }, errors: ["publish: wrangler exited with code 1"], postponed: true, published: false, at: "2026-10-28T14:03:00.000Z" });
  const src = addSource(db, { url: "https://broken.example.com/news", kind: "ir_news", company: "Broken" });
  for (const d of ["01", "02", "03"]) recordCheck(db, src, { ok: false, error: "HTTP 503", at: `2026-10-${d}T00:00:00Z` });
  const doc = addFoundDocument(db, { url: "https://broken.example.com/news/1", title: "t", sourceId: src, projectId: null, status: "found" })!;
  setDocumentStatus(db, doc, "failed", { error: "<script>alert(1)</script>" });
  db.prepare("INSERT INTO meta (key, value) VALUES ('quota_exhausted_at', '2026-10-27T15:00:00.000Z')").run();
  return h;
}

describe("runs and health tab", () => {
  it("shows runs, errors, broken sources, failed documents, quota and the next run", async () => {
    const { get } = await withHistory();
    const body = await (await get("/health")).text();
    expect(body).toContain("catch-up");
    expect(body).toContain("publish: wrangler exited with code 1");
    expect(body).toContain("https://broken.example.com/news");
    expect(body).toContain("HTTP 503");
    expect(body).toContain("https://broken.example.com/news/1");
    expect(body).toContain("Workers AI quota last ran out");
    // Now is 15:00Z on 28 Oct, so the next run is 03:00 New York on the 29th.
    expect(body).toContain("Oct 29, 2026, 3:00");
    expect(body).toContain("Run now");
    expect(body).toContain("Publish now");
  });

  it("escapes error text from documents", async () => {
    const { get } = await withHistory();
    const body = await (await get("/health")).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("refuses a button press from another site", async () => {
    const { post, actions } = await adminApp();
    const res = await post("/health/run", {}, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(actions.runs).toBe(0);
    const res2 = await post("/health/run", {}, { "sec-fetch-site": "cross-site" });
    expect(res2.status).toBe(403);
    expect(actions.runs).toBe(0);
  });

  it("starts a run from the page and returns to the tab with a notice", async () => {
    const { post, get, actions } = await adminApp();
    const res = await post("/health/run");
    expect(res.status).toBe(303);
    expect(actions.runs).toBe(1);
    const location = res.headers.get("location")!;
    expect(location.startsWith("/health?notice=")).toBe(true);
    expect(await (await get(location)).text()).toContain("Run started");
  });

  it("says when publishing has to wait for a run", async () => {
    const { post, get } = await adminApp({ actions: { runNow: () => ({ started: true }), publishNow: async () => ({ busy: true }) } });
    const res = await post("/health/publish");
    expect(await (await get(res.headers.get("location")!)).text()).toContain("A run is in progress; it will publish when it finishes.");
  });
});
