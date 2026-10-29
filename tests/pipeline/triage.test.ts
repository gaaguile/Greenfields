import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../../src/log.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import { InvalidModelOutputError } from "../../src/pipeline/modelJson.ts";
import { triageReadDocuments } from "../../src/pipeline/triage.ts";
import { openDb } from "../../src/store/db.ts";
import { addFoundDocument, listDocumentsByStatus, setDocumentStatus } from "../../src/store/documents.ts";
import { listProjects } from "../../src/store/projects.ts";
import { addSource } from "../../src/store/sources.ts";
import { scriptedProvider } from "../helpers/fakeProvider.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));
const log: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const reply = (o: object) => JSON.stringify(o);
const material = { projectSlug: "vizcachitas", category: "study", material: true, possibleNewProject: false, reason: "PFS update" };

// One read document from a company-wide source (no project), so every active project is a candidate.
function setup(text = "Los Andes Copper announces an updated pre-feasibility study for Vizcachitas.") {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  const sourceId = addSource(db, { url: "https://x.com/news", kind: "ir_news", company: "X" });
  const id = addFoundDocument(db, { url: "https://x.com/news/1", title: "PFS update", sourceId, projectId: null, status: "found" })!;
  setDocumentStatus(db, id, "read", { text });
  return { db, id };
}

describe("triageReadDocuments", () => {
  it("marks a material document triaged and sets its project", async () => {
    const { db } = setup();
    const p = scriptedProvider([reply(material)]);
    expect(await triageReadDocuments(db, p, log, { maxChars: 60000 })).toEqual({ triaged: 1, routine: 0, failed: 0 });
    const [doc] = listDocumentsByStatus(db, ["triaged"]);
    expect(doc.projectId).toBe(listProjects(db).find((x) => x.slug === "vizcachitas")!.id);
    expect(JSON.parse(doc.triage!)).toMatchObject({ category: "study", material: true });
    // Every active project is offered as a candidate.
    expect(p.requests[0].system).toContain("cerro-casale");
  });

  it("ends routine documents at done", async () => {
    const { db } = setup();
    const p = scriptedProvider([reply({ ...material, category: "routine", material: false })]);
    expect(await triageReadDocuments(db, p, log, { maxChars: 60000 })).toEqual({ triaged: 0, routine: 1, failed: 0 });
    expect(listDocumentsByStatus(db, ["done"]).map((d) => d.url)).toContain("https://x.com/news/1");
  });

  it("treats a project that is not a candidate as no project", async () => {
    const { db } = setup();
    const p = scriptedProvider([reply({ ...material, projectSlug: "made-up-project" })]);
    await triageReadDocuments(db, p, log, { maxChars: 60000 });
    // The import's own source documents are also `done`, so pick ours by URL.
    const doc = listDocumentsByStatus(db, ["done"]).find((d) => d.url === "https://x.com/news/1")!;
    expect(doc.projectId).toBeNull();
  });

  it("only offers the source's own project when the source belongs to one", async () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
    const viz = listProjects(db).find((x) => x.slug === "vizcachitas")!;
    const sourceId = addSource(db, { url: "https://la.com/news", kind: "ir_news", projectSlug: "vizcachitas" });
    const id = addFoundDocument(db, { url: "https://la.com/news/1", title: "t", sourceId, projectId: viz.id, status: "found" })!;
    setDocumentStatus(db, id, "read", { text: "text" });
    const p = scriptedProvider([reply(material)]);
    await triageReadDocuments(db, p, log, { maxChars: 60000 });
    expect(p.requests[0].system).toContain("vizcachitas");
    expect(p.requests[0].system).not.toContain("cerro-casale");
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const { db } = setup();
    const p = scriptedProvider(["```json\n" + reply(material) + "\n```"]);
    expect((await triageReadDocuments(db, p, log, { maxChars: 60000 })).triaged).toBe(1);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const { db } = setup();
    const p = scriptedProvider([reply({ ...material, category: "gossip" }), reply(material)]);
    expect((await triageReadDocuments(db, p, log, { maxChars: 60000 })).triaged).toBe(1);
    expect(p.requests).toHaveLength(2);
    expect(p.requests[1].user).toContain("category");
  });

  it("marks the document failed after two invalid replies", async () => {
    const { db } = setup();
    const p = scriptedProvider(["not json", "still not json"]);
    expect((await triageReadDocuments(db, p, log, { maxChars: 60000 })).failed).toBe(1);
    const [doc] = listDocumentsByStatus(db, ["failed"]);
    expect(doc.error).toContain(InvalidModelOutputError.name);
  });

  it("sends at most the first 8,000 characters", async () => {
    const { db } = setup("a".repeat(20000));
    const p = scriptedProvider([reply(material)]);
    await triageReadDocuments(db, p, log, { maxChars: 60000 });
    expect(p.requests[0].user.length).toBeLessThan(8500);
  });
});

describe("triage routing of possible new projects", () => {
  it("sends a possible new project with no tracked match to candidate", async () => {
    const { db } = setup();
    const p = scriptedProvider([reply({ ...material, projectSlug: null, possibleNewProject: true, category: "drilling" })]);
    await triageReadDocuments(db, p, log, { maxChars: 60000 });
    expect(listDocumentsByStatus(db, ["candidate"]).map((d) => d.url)).toEqual(["https://x.com/news/1"]);
  });

  it("keeps the normal route when the document matched a tracked project", async () => {
    const { db } = setup();
    const p = scriptedProvider([reply({ ...material, possibleNewProject: true })]);
    await triageReadDocuments(db, p, log, { maxChars: 60000 });
    expect(listDocumentsByStatus(db, ["triaged"])).toHaveLength(1);
    expect(listDocumentsByStatus(db, ["candidate"])).toHaveLength(0);
  });
});
