import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../../src/log.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import { extractFigures } from "../../src/pipeline/extract.ts";
import { openDb } from "../../src/store/db.ts";
import { getPublished } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";
import { scriptedProvider } from "../helpers/fakeProvider.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));

const docText =
  "Los Andes Copper announces the results of its updated pre-feasibility study. The study estimates initial capital " +
  "costs of US$2.7 billion and a mine life of 28 years at a throughput of 150,000 tonnes per day.";

const figure = (o: object) => ({
  valueNum: null, unit: null, basis: "100%", attributableShare: null, figureDate: "2026-10-01", confidence: 0.9, ...o,
});

const goodReply = JSON.stringify({
  figures: [
    figure({ field: "capex_usd", valueText: "US$2.7 billion", valueNum: 2.7e9, unit: "USD", quote: "initial capital costs of US$2.7 billion" }),
    figure({ field: "mine_life_years", valueText: "28 years", valueNum: 28, unit: "years", quote: "a mine life of 28 years" }),
    // Not in the document: must be dropped.
    figure({ field: "grade", valueText: "0.45% Cu", quote: "an average grade of 0.45% copper" }),
  ],
});

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  const project = listProjects(db).find((p) => p.slug === "vizcachitas")!;
  return { db, project, published: getPublished(db, project.id) };
}

function recordingLog() {
  const lines: { msg: string; data?: object }[] = [];
  const log: Logger = {
    info: (msg, data) => lines.push({ msg, data }),
    warn: (msg, data) => lines.push({ msg, data }),
    error: (msg, data) => lines.push({ msg, data }),
  };
  return { log, lines };
}

describe("extractFigures", () => {
  it("returns only figures whose quote is in the document and logs the dropped one", async () => {
    const { project, published } = setup();
    const { log, lines } = recordingLog();
    const p = scriptedProvider([goodReply]);
    const figs = await extractFigures(p, { title: "PFS", text: docText }, project, published, 60000, log);
    expect(figs.map((f) => f.field)).toEqual(["capex_usd", "mine_life_years"]);
    expect(lines.some((l) => l.msg.includes("quote not found") && JSON.stringify(l.data).includes("grade"))).toBe(true);
  });

  it("gives the model the project's current published figures", async () => {
    const { project, published } = setup();
    const p = scriptedProvider([goodReply]);
    await extractFigures(p, { title: "PFS", text: docText }, project, published, 60000, recordingLog().log);
    const capex = published.find((v) => v.field === "capex_usd")!;
    expect(p.requests[0].system).toContain(capex.valueText);
    expect(p.requests[0].system).toContain("Vizcachitas");
  });

  it("treats a confidence outside 0-1 as invalid output and retries", async () => {
    const { project, published } = setup();
    const bad = JSON.stringify({ figures: [figure({ field: "capex_usd", valueText: "x", quote: "initial capital costs of US$2.7 billion", confidence: 7 })] });
    const p = scriptedProvider([bad, goodReply]);
    const figs = await extractFigures(p, { title: "PFS", text: docText }, project, published, 60000, recordingLog().log);
    expect(p.requests).toHaveLength(2);
    expect(figs).toHaveLength(2);
  });

  it("sends at most maxChars of the document", async () => {
    const { project, published } = setup();
    const p = scriptedProvider([JSON.stringify({ figures: [] })]);
    await extractFigures(p, { title: "PFS", text: "z".repeat(5000) }, project, published, 1000, recordingLog().log);
    expect(p.requests[0].user.split("z").length - 1).toBe(1000);
  });
});
