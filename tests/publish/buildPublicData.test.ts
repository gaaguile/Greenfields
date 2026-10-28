import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import/importDataset.ts";
import { buildPublicData } from "../../src/publish/buildPublicData.ts";
import { openDb } from "../../src/store/db.ts";
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
