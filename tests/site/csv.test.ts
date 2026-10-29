import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import/importDataset.ts";
import { buildSite } from "../../src/publish/buildSite.ts";
import type { PublicProject } from "../../src/publish/publicTypes.ts";
import { openDb } from "../../src/store/db.ts";
import { toCsv } from "../../site/src/csv.ts";

// Minimal RFC 4180 parser, test-only.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const project: PublicProject = {
  slug: "x", name: "Cerro Chañar", owners: "Barrick / Newmont (50/50 JV; inherited)", minerals: ["Cu"],
  mineralsText: "Copper, Molybdenum", region: "Coquimbo", province: null, locationDetail: null,
  stage: "scoping_pea", stageLabel: "Scoping/PEA", stageText: "", stalled: false, capex: null,
  mineLife: "20 years", resourceReserve: null, additionalInfo: 'He said "big", then left\nnext line',
  lastUpdated: "2026-10-27T10:00:00.000Z", latestReport: "2026-10-15T12:00:00.000Z", sourceUrl: "https://example.com/a", figures: [], recentChanges: [],
};

describe("toCsv", () => {
  const csv = toCsv([project]);

  it("starts with a UTF-8 BOM and uses CRLF", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(
      "﻿Project,Owner(s),Minerals,Region,Stage,Capex (US$),Mine life,Resource/reserve,Additional info,Latest report,Source",
    );
  });

  it("round-trips commas, quotes and line breaks", () => {
    const [, row] = parseCsv(csv.slice(1));
    expect(row[0]).toBe("Cerro Chañar");
    expect(row[1]).toBe("Barrick / Newmont (50/50 JV; inherited)");
    expect(row[8]).toBe('He said "big", then left\nnext line');
  });

  it("neutralises cells Excel would run as formulas", () => {
    const [, row] = parseCsv(toCsv([{ ...project, additionalInfo: '=HYPERLINK("http://x","y")', owners: "@SUM(1)" }]).slice(1));
    expect(row[8]).toBe(`'=HYPERLINK("http://x","y")`);
    expect(row[1]).toBe("'@SUM(1)");
  });

  it("writes missing values as empty cells and the latest report date", () => {
    const [, row] = parseCsv(csv.slice(1));
    expect(row[9]).toBe("2026-10-15");
    expect(row[5]).toBe("");
    expect(row[10]).toBe("https://example.com/a");
  });
});

describe("buildSite", () => {
  const fixture = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"),
  );

  it("writes the page, bundle and data, with a hash that ignores generatedAt", async () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, "2026-10-01T00:00:00.000Z");
    const out = mkdtempSync(path.join(os.tmpdir(), "gf-site-"));
    const first = await buildSite(db, out, "2026-10-28T12:00:00.000Z");
    for (const f of ["index.html", "styles.css", "app.js", "projects.json"]) expect(existsSync(path.join(out, f))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(out, "projects.json"), "utf8")).projects).toHaveLength(3);
    const second = await buildSite(db, out, "2026-10-28T15:00:00.000Z");
    expect(second.projectsJsonHash).toBe(first.projectsJsonHash);
    expect(first.projectsJsonHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when the page's code or styles change", async () => {
    const db = openDb(":memory:");
    importDataset(db, fixture, "2026-10-01T00:00:00.000Z");
    // The copy sits next to site/ so its relative imports of ../../src still resolve.
    const repoRoot = path.resolve(import.meta.dirname, "../..");
    const siteCopy = mkdtempSync(path.join(repoRoot, ".test-site-"));
    try {
      cpSync(path.join(repoRoot, "site"), siteCopy, { recursive: true });
      const out = () => mkdtempSync(path.join(os.tmpdir(), "gf-site-"));
      const before = await buildSite(db, out(), "2026-10-28T12:00:00.000Z", 7, siteCopy);
      appendFileSync(path.join(siteCopy, "styles.css"), "\nbody { color: red; }\n");
      const after = await buildSite(db, out(), "2026-10-28T12:00:00.000Z", 7, siteCopy);
      expect(after.projectsJsonHash).not.toBe(before.projectsJsonHash);
    } finally {
      rmSync(siteCopy, { recursive: true, force: true });
    }
  });
});
