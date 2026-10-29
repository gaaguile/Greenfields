import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import/importDataset.ts";
import { buildPublicData } from "../../src/publish/buildPublicData.ts";
import { openDb } from "../../src/store/db.ts";
import { upsertDocument } from "../../src/store/documents.ts";
import { insertFieldValue, publishFieldValue } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";

const root = path.resolve(import.meta.dirname, "../..");
const fixture = JSON.parse(readFileSync(path.join(root, "tests/fixtures/dataset-small.json"), "utf8"));
const IMPORTED = "2026-10-01T12:00:00.000Z";
const NOW = "2026-10-28T12:00:00.000Z";

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, IMPORTED);
  const viz = listProjects(db).find((p) => p.name === "Vizcachitas")!;
  return { db, viz };
}

describe("buildPublicData", () => {
  it("returns every active project with table fields", () => {
    const { db } = setup();
    const data = buildPublicData(db, NOW, 7);
    expect(data.generatedAt).toBe(NOW);
    expect(data.projects).toHaveLength(3);
    const viz = data.projects.find((p) => p.slug === "vizcachitas")!;
    expect(viz.capex).toContain("2.4-2.8 billion");
    expect(viz.minerals).toEqual(["Cu", "Mo", "Ag"]);
    expect(viz.mineralsText).toBe("Copper, Molybdenum, Silver");
    expect(viz.stageLabel).toBe("PFS");
    expect(viz.resourceReserve).toContain("1.22 billion tonnes");
    expect(viz.lastUpdated).toBe(IMPORTED);
    expect(viz.sourceUrl).toMatch(/^https:\/\//);
    expect(viz.figures.find((f) => f.field === "capex_usd")!.sourceUrl).toBe(viz.sourceUrl);
  });

  it("orders figures by field, with additional info last", () => {
    const { db } = setup();
    const viz = buildPublicData(db, NOW, 7).projects.find((p) => p.slug === "vizcachitas")!;
    expect(viz.figures.map((f) => f.field)).toEqual([
      "capex_usd", "mine_life_years", "reserve_headline", "annual_production", "c1_cost", "throughput_tpd",
      "additional_info",
    ]);
  });

  it("prefers the reserve headline over the resource headline", () => {
    const { db } = setup();
    const casale = buildPublicData(db, NOW, 7).projects.find((p) => p.slug === "cerro-casale")!;
    expect(casale.resourceReserve).toContain("17.4 Moz Au");
    expect(casale.figures.find((f) => f.field === "reserve_headline")!.attributableShare).toBe(0.75);
  });

  it("never exposes pending values", () => {
    const { db, viz } = setup();
    insertFieldValue(db, { projectId: viz.id, field: "capex_usd", valueText: "US$9 billion", status: "pending" });
    const out = buildPublicData(db, NOW, 7).projects.find((p) => p.slug === "vizcachitas")!;
    expect(out.capex).toContain("2.4-2.8 billion");
    expect(JSON.stringify(out)).not.toContain("US$9 billion");
  });

  it("excludes paused projects", () => {
    const { db, viz } = setup();
    db.prepare("UPDATE projects SET tracking = 'paused' WHERE id = ?").run(viz.id);
    expect(buildPublicData(db, NOW, 7).projects.map((p) => p.slug)).not.toContain("vizcachitas");
  });

  it("lists recent changes with the superseded value", () => {
    const { db, viz } = setup();
    const id = insertFieldValue(db, {
      projectId: viz.id, field: "mine_life_years", valueText: "30 years", valueNum: 30, status: "pending",
    });
    publishFieldValue(db, id, "auto", "2026-10-27T10:00:00.000Z");
    const out = buildPublicData(db, NOW, 7).projects.find((p) => p.slug === "vizcachitas")!;
    expect(out.recentChanges[0]).toMatchObject({
      field: "mine_life_years",
      label: "Mine life",
      oldValue: "26 years",
      newValue: "30 years",
      changedAt: "2026-10-27T10:00:00.000Z",
    });
    expect(out.recentChanges).toHaveLength(1); // imported values are older than 7 days
    expect(out.lastUpdated).toBe("2026-10-27T10:00:00.000Z");
  });
});

describe("buildPublicData with owner-approved project fields", () => {
  it("keeps stage, owners and minerals out of the figures and labels their changes", () => {
    const { db, viz } = setup();
    const decide = (field: string, valueText: string, at: string) => {
      const id = insertFieldValue(db, { projectId: viz.id, field, valueText, status: "pending" });
      publishFieldValue(db, id, "owner", at);
    };
    decide("stage", "Feasibility study", "2026-10-25T12:00:00.000Z");
    decide("owners", "Los Andes Copper 80% / Partner 20%", "2026-10-25T12:00:00.000Z");
    decide("stage", "Permitting (EIA submitted)", "2026-10-26T12:00:00.000Z");
    const p = buildPublicData(db, NOW, 7).projects.find((x) => x.slug === "vizcachitas")!;
    expect(p.figures.map((f) => f.field)).not.toEqual(expect.arrayContaining(["stage"]));
    expect(p.figures.some((f) => ["stage", "owners", "minerals"].includes(f.field))).toBe(false);
    // The first change of a project field has no earlier value on record, so it is not shown as "(new)".
    expect(p.recentChanges.filter((c) => c.field === "stage" || c.field === "owners")).toEqual([
      expect.objectContaining({ field: "stage", label: "Stage", oldValue: "Feasibility study", newValue: "Permitting (EIA submitted)" }),
    ]);
  });
});

describe("buildPublicData latest report date", () => {
  // A published figure whose source document has the given publication date (or none).
  function withDoc(db: ReturnType<typeof openDb>, projectId: number, field: string, url: string, publishedAt: string | null) {
    const doc = upsertDocument(db, { url, publishedAt: publishedAt ?? undefined, status: "done" });
    const id = insertFieldValue(db, { projectId, field, valueText: "x", documentId: doc, status: "pending" });
    publishFieldValue(db, id, "auto", "2026-10-28T10:00:00.000Z");
  }
  const latest = (db: ReturnType<typeof openDb>) =>
    buildPublicData(db, NOW, 7).projects.find((p) => p.slug === "vizcachitas")!.latestReport;

  it("is unknown when no source document has a date and none was typed", () => {
    const { db } = setup();
    // The fixture's sources are undated pages, and the day they were imported is not a report date.
    expect(latest(db)).toBeNull();
  });

  it("uses the newest publication date among the documents behind the published figures", () => {
    const { db, viz } = setup();
    withDoc(db, viz.id, "grade", "https://x.com/a", "2026-09-28");
    withDoc(db, viz.id, "c1_cost", "https://x.com/b", "2026-01-20");
    expect(latest(db)).toBe("2026-09-28T12:00:00.000Z");
  });

  it("reads a date from the source address when the document has none stored", () => {
    const { db, viz } = setup();
    withDoc(db, viz.id, "grade", "https://energiminas.com/2026/08/27/chile-news", null);
    expect(latest(db)).toBe("2026-08-27T12:00:00.000Z");
  });

  it("falls back to the date the owner typed, and a document date wins over it", () => {
    const { db, viz } = setup();
    db.prepare("UPDATE projects SET report_date = '2026-06-30' WHERE id = ?").run(viz.id);
    expect(latest(db)).toBe("2026-06-30T12:00:00.000Z");
    withDoc(db, viz.id, "grade", "https://x.com/a", "2026-05-01");
    expect(latest(db)).toBe("2026-05-01T12:00:00.000Z");
  });
});
