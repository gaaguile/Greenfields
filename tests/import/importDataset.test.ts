import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { datasetAsOf, importDataset } from "../../src/import/importDataset.ts";
import { openDb } from "../../src/store/db.ts";
import { getPublished } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";

const root = path.resolve(import.meta.dirname, "../..");
const fixture = JSON.parse(readFileSync(path.join(root, "tests/fixtures/dataset-small.json"), "utf8"));
const NOW = "2026-10-28T12:00:00.000Z";

function published(db: ReturnType<typeof openDb>, name: string) {
  const p = listProjects(db).find((x) => x.name === name)!;
  return { project: p, values: Object.fromEntries(getPublished(db, p.id).map((v) => [v.field, v])) };
}

describe("importDataset", () => {
  it("creates the fixture's three projects", () => {
    const db = openDb(":memory:");
    expect(importDataset(db, fixture, NOW)).toMatchObject({ created: 3, updated: 0 });
  });

  it("maps Vizcachitas' stage and figures", () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, NOW);
    const { project, values } = published(db, "Vizcachitas");
    expect(project.stage).toBe("pfs");
    expect(values.capex_usd.valueText).toContain("2.4-2.8 billion");
    expect(values.mine_life_years.valueNum).toBe(26);
    expect(values.mine_life_years.valueText).toBe("26 years");
    expect(values.additional_info.valueText).toContain("Notes:");
    expect(values.additional_info.valueText).toContain("Process:");
    expect(values.capex_usd.documentId).not.toBeNull();
  });

  it("marks Cerro Casale's 75% figures as attributable and the project stalled", () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, NOW);
    const { project, values } = published(db, "Cerro Casale");
    expect(project.stalled).toBe(true);
    expect(values.reserve_headline.basis).toBe("attributable");
    expect(values.reserve_headline.attributableShare).toBe(0.75);
    expect(values.reserve_headline.valueText).toContain("(75% basis)");
  });

  it("formats capex given in millions with trailing text", () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, NOW);
    const { values } = published(db, "Proyecto Blanco (Salar Blanco)");
    expect(values.capex_usd.valueText).toBe("US$530-700 million (estimates vary by report vintage)");
    expect(values.capex_usd.valueNum).toBe(530e6);
  });

  it("is idempotent when re-run", () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, NOW);
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM field_values").get() as { n: number }).n;
    const before = count();
    expect(importDataset(db, fixture, NOW)).toMatchObject({ created: 0, updated: 3, figures: 0 });
    expect(count()).toBe(before);
  });

  it("does not overwrite an existing project's details on re-import", () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, NOW);
    const before = listProjects(db).find((p) => p.slug === "vizcachitas")!;
    const edited = structuredClone(fixture);
    edited.projects[0].owner = "Someone else";
    edited.projects[0].development_stage = "Feasibility study";
    importDataset(db, edited, NOW);
    const after = listProjects(db).find((p) => p.slug === "vizcachitas")!;
    expect(after.owners).toBe(before.owners);
    expect(after.stage).toBe(before.stage);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("parses the dataset's as_of month into a timestamp", () => {
    // Noon UTC, so the date reads 1 Sep in New York too.
    expect(datasetAsOf({ as_of: "September 2026" })).toBe("2026-09-01T12:00:00.000Z");
    expect(datasetAsOf({ as_of: "sometime" })).toBeNull();
    expect(datasetAsOf({})).toBeNull();
  });

  it("imports all 17 real projects with a stage", () => {
    const db = openDb(":memory:");
    const real = JSON.parse(readFileSync(path.join(root, "data/chile_greenfield_projects.json"), "utf8"));
    expect(importDataset(db, real, NOW).created).toBe(17);
    expect(listProjects(db).every((p) => p.stage)).toBe(true);
  });
});
