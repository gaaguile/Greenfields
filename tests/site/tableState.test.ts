import { describe, expect, it } from "vitest";
import type { PublicProject } from "../../src/publish/publicTypes.ts";
import { applyQuery, distinctValues, isRecentlyUpdated, type TableQuery } from "../../site/src/tableState.ts";

function makeProject(overrides: Partial<PublicProject>): PublicProject {
  return {
    slug: "x", name: "X", owners: "", minerals: [], mineralsText: "", region: "Atacama", province: null,
    locationDetail: null, stage: "exploration", stageLabel: "Exploration", stageText: "", stalled: false,
    capex: null, mineLife: null, resourceReserve: null, additionalInfo: null,
    lastUpdated: "2026-10-01T00:00:00.000Z", sourceUrl: null, figures: [], recentChanges: [],
    ...overrides,
  };
}

const projects = [
  makeProject({ slug: "nu", name: "NuevaUnión", owners: "Newmont / Teck", minerals: ["Cu", "Au"], stage: "pfs" }),
  makeProject({ slug: "cc", name: "Cerro Casale", owners: "Barrick / Newmont", minerals: ["Au", "Cu"], stage: "fs", capex: null }),
  makeProject({ slug: "vz", name: "Vizcachitas", region: "Valparaíso", minerals: ["Cu", "Mo"], stage: "pfs", capex: "US$2.4-2.8 billion" }),
  makeProject({ slug: "pb", name: "Proyecto Blanco", minerals: ["Li"], stage: "permitting", capex: "US$530-700 million" }),
  makeProject({ slug: "fx", name: "Fenix Gold", minerals: ["Au"], stage: "construction", capex: "US$235 million" }),
  makeProject({ slug: "ex", name: "Los Helados", minerals: ["Cu", "Au"], stage: "exploration", additionalInfo: "Notes: big porphyry" }),
];

const q = (overrides: Partial<TableQuery> = {}): TableQuery => ({
  search: "", minerals: [], regions: [], stages: [], hideEarlyExploration: false, sortKey: "name", sortDir: "asc",
  ...overrides,
});
const slugs = (ps: PublicProject[]) => ps.map((p) => p.slug);

describe("applyQuery search", () => {
  it("ignores accents and case", () => {
    expect(slugs(applyQuery(projects, q({ search: "nueva union" })))).toEqual(["nu"]);
  });
  it("does not search the region", () => {
    expect(applyQuery(projects, q({ search: "VALPARAISO" }))).toEqual([]);
  });
  it("matches owners and additional info", () => {
    expect(slugs(applyQuery(projects, q({ search: "barrick" })))).toEqual(["cc"]);
    expect(slugs(applyQuery(projects, q({ search: "PORPHYRY" })))).toEqual(["ex"]);
  });
});

describe("applyQuery filters", () => {
  it("ANDs facets and ORs values within a facet", () => {
    expect(slugs(applyQuery(projects, q({ minerals: ["Au"], stages: ["pfs", "fs"] })))).toEqual(["cc", "nu"]);
    expect(slugs(applyQuery(projects, q({ minerals: ["Li", "Mo"] })))).toEqual(["pb", "vz"]);
    expect(slugs(applyQuery(projects, q({ regions: ["Valparaíso"] })))).toEqual(["vz"]);
  });
  it("hides early exploration", () => {
    expect(slugs(applyQuery(projects, q({ hideEarlyExploration: true })))).not.toContain("ex");
  });
});

describe("applyQuery sort", () => {
  it("keeps missing capex last in both directions and compares millions with billions", () => {
    const asc = slugs(applyQuery(projects, q({ sortKey: "capex", sortDir: "asc" })));
    const desc = slugs(applyQuery(projects, q({ sortKey: "capex", sortDir: "desc" })));
    expect(asc.slice(0, 3)).toEqual(["fx", "pb", "vz"]);
    expect(desc.slice(0, 3)).toEqual(["vz", "pb", "fx"]);
    expect(asc.slice(3).every((s) => ["nu", "cc", "ex"].includes(s))).toBe(true);
    expect(desc.slice(3).every((s) => ["nu", "cc", "ex"].includes(s))).toBe(true);
  });
  it("sorts stage by pipeline order", () => {
    const asc = slugs(applyQuery(projects, q({ sortKey: "stage" })));
    expect(asc.indexOf("ex")).toBeLessThan(asc.indexOf("vz"));
    expect(asc.indexOf("vz")).toBeLessThan(asc.indexOf("fx"));
  });
  it("does not mutate its input", () => {
    const copy = slugs(projects);
    applyQuery(projects, q({ sortKey: "name", sortDir: "desc" }));
    expect(slugs(projects)).toEqual(copy);
  });
});

describe("isRecentlyUpdated", () => {
  const p = makeProject({ lastUpdated: "2026-10-20T12:00:00.000Z" });
  it("is true within the window and false outside it", () => {
    expect(isRecentlyUpdated(p, "2026-10-26T12:00:00.000Z", 7)).toBe(true);
    expect(isRecentlyUpdated(p, "2026-10-28T12:00:00.000Z", 7)).toBe(false);
  });
});

describe("distinctValues", () => {
  it("returns sorted unique minerals and regions", () => {
    expect(distinctValues(projects)).toEqual({
      minerals: ["Au", "Cu", "Li", "Mo"],
      regions: ["Atacama", "Valparaíso"],
    });
  });
});
