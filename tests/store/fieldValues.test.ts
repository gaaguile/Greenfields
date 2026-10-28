import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.ts";
import { slugify, ensureProject } from "../../src/store/projects.ts";
import { getHistory, getPublished, insertFieldValue, publishFieldValue } from "../../src/store/fieldValues.ts";

function setup() {
  const db = openDb(":memory:");
  const { id } = ensureProject(db, {
    slug: "vizcachitas",
    name: "Vizcachitas",
    owners: "Los Andes Copper",
    minerals: ["Copper"],
    region: "Valparaíso",
    stage: "pfs",
    stageText: "PFS completed",
    stalled: false,
  });
  return { db, id };
}

const base = { field: "mine_life_years", status: "pending" as const, basis: "100%" as const };

describe("field values", () => {
  it("publishing a newer value supersedes the older one", () => {
    const { db, id } = setup();
    const a = insertFieldValue(db, { ...base, projectId: id, valueText: "26 years", valueNum: 26 });
    publishFieldValue(db, a, "owner");
    const b = insertFieldValue(db, { ...base, projectId: id, valueText: "30 years", valueNum: 30 });
    publishFieldValue(db, b, "auto");

    const published = getPublished(db, id);
    expect(published.map((r) => r.id)).toEqual([b]);
    expect(getHistory(db, id).map((r) => [r.id, r.status])).toEqual([
      [b, "published"],
      [a, "superseded"],
    ]);
  });

  it("ensureProject matches on slug", () => {
    const { db, id } = setup();
    const again = ensureProject(db, {
      slug: "vizcachitas", name: "Vizcachitas", owners: "New owner", minerals: ["Copper"],
      region: "Valparaíso", stage: "fs", stageText: "FS", stalled: false,
    });
    expect(again).toEqual({ id, created: false });
  });

  it("slugify strips accents and punctuation", () => {
    expect(slugify("NuevaUnión")).toBe("nuevaunion");
    expect(slugify("Proyecto Blanco (Salar Blanco)")).toBe("proyecto-blanco-salar-blanco");
  });
});
