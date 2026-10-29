import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import/importDataset.ts";
import { buildPublicData } from "../../src/publish/buildPublicData.ts";
import { openDb } from "../../src/store/db.ts";
import { upsertDocument } from "../../src/store/documents.ts";
import { getPublished, insertFieldValue, publishFieldValue } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { approvePending, editAndApprove, listPending, rejectPending } from "../../src/store/review.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));
const AT = "2026-10-28T15:00:00.000Z";

export function reviewSetup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  const viz = listProjects(db).find((p) => p.slug === "vizcachitas")!;
  const doc = upsertDocument(db, { url: "https://losandescopper.com/news/2026/pfs/", title: "PFS update", status: "done" });
  const hold = (field: string, valueText: string, valueNum: number | null = null, reason = "change beyond ±20%") =>
    insertFieldValue(db, {
      projectId: viz.id, field, valueText, valueNum, unit: valueNum === null ? null : "USD", documentId: doc,
      quote: `quote for ${valueText}`, confidence: 0.9, status: "pending", holdReason: reason,
    });
  const published = (field: string) => getPublished(db, viz.id).find((v) => v.field === field);
  const row = (id: number) => db.prepare("SELECT * FROM field_values WHERE id = ?").get(id) as Record<string, unknown>;
  const project = () => listProjects(db).find((p) => p.slug === "vizcachitas")!;
  return { db, viz, doc, hold, published, row, project };
}

describe("listPending", () => {
  it("lists held items with the current value, source and reason", () => {
    const { db, hold } = reviewSetup();
    hold("capex_usd", "US$3.5 billion", 3.5e9);
    const [item] = listPending(db);
    expect(item).toMatchObject({
      projectName: "Vizcachitas", field: "capex_usd", label: "Capex (US$)", proposed: "US$3.5 billion",
      current: "US$2.4-2.8 billion", holdReason: "change beyond ±20%", documentUrl: "https://losandescopper.com/news/2026/pfs/",
      newerPublished: false,
    });
  });

  it("shows the project's own stage as the current value of a stage change", () => {
    const { db, hold } = reviewSetup();
    hold("stage", "Feasibility study", null, "stage/owner/mineral change");
    expect(listPending(db)[0]).toMatchObject({ label: "Stage", current: "Pre-Feasibility Study (PFS) completed" });
  });

  it("warns when a newer value was published after the item was held", () => {
    const { db, hold, viz } = reviewSetup();
    hold("capex_usd", "US$3.5 billion", 3.5e9);
    const newer = insertFieldValue(db, { projectId: viz.id, field: "capex_usd", valueText: "US$2.9 billion", valueNum: 2.9e9, status: "pending" });
    publishFieldValue(db, newer, "auto", "2099-01-01T00:00:00.000Z");
    expect(listPending(db)[0].newerPublished).toBe(true);
  });
});

describe("approvePending", () => {
  it("publishes the value as the owner and supersedes the old one", () => {
    const { db, hold, published, row } = reviewSetup();
    const oldId = published("capex_usd")!.id;
    const id = hold("capex_usd", "US$3.5 billion", 3.5e9);
    approvePending(db, id, AT);
    expect(published("capex_usd")).toMatchObject({ id, valueText: "US$3.5 billion", decidedBy: "owner", decidedAt: AT });
    expect(row(oldId).status).toBe("superseded");
  });

  it("updates the project's stage so the public table shows it", () => {
    const { db, hold, project } = reviewSetup();
    approvePending(db, hold("stage", "Feasibility study", null, "stage/owner/mineral change"), AT);
    expect(project()).toMatchObject({ stage: "fs", stageText: "Feasibility study", stalled: false });
    const pub = buildPublicData(db, AT, 7).projects.find((p) => p.slug === "vizcachitas")!;
    expect(pub.stageLabel).toBe("FS");
  });

  it("stores approved minerals as symbols and owners as text", () => {
    const { db, hold, project } = reviewSetup();
    approvePending(db, hold("minerals", "Copper, Gold", null, "stage/owner/mineral change"), AT);
    approvePending(db, hold("owners", "Los Andes Copper 80% / Partner 20%", null, "stage/owner/mineral change"), AT);
    expect(project()).toMatchObject({ minerals: ["Cu", "Au"], owners: "Los Andes Copper 80% / Partner 20%" });
  });

  it("refuses an item that is no longer pending", () => {
    const { db, hold } = reviewSetup();
    const id = hold("capex_usd", "US$3.5 billion", 3.5e9);
    approvePending(db, id, AT);
    expect(() => approvePending(db, id, AT)).toThrow("not pending");
    expect(() => rejectPending(db, id, AT)).toThrow("not pending");
  });
});

describe("editAndApprove", () => {
  it("publishes a corrected copy and keeps the original as it was, marked rejected", () => {
    const { db, hold, published, row, doc } = reviewSetup();
    const id = hold("capex_usd", "US$3.5 billion", 3.5e9);
    const newId = editAndApprove(db, id, { valueText: "US$3.2 billion", valueNum: 3.2e9 }, AT);
    expect(row(id)).toMatchObject({ value_text: "US$3.5 billion", status: "rejected", decided_by: "owner" });
    expect(published("capex_usd")).toMatchObject({
      id: newId, valueText: "US$3.2 billion", valueNum: 3.2e9, documentId: doc, quote: "quote for US$3.5 billion", decidedBy: "owner",
    });
  });
});

describe("rejectPending", () => {
  it("keeps the published value", () => {
    const { db, hold, published } = reviewSetup();
    const before = published("capex_usd")!.valueText;
    const id = hold("capex_usd", "US$3.5 billion", 3.5e9);
    rejectPending(db, id, AT);
    expect(published("capex_usd")!.valueText).toBe(before);
    expect(listPending(db)).toEqual([]);
  });
});
