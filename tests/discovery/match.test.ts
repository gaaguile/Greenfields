import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { foldName, matchCandidate, namesMatch, ownerWords } from "../../src/discovery/match.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import type { CandidateProject } from "../../src/pipeline/candidate.ts";
import { openDb } from "../../src/store/db.ts";
import { ensureProject, listProjects } from "../../src/store/projects.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));

const cand = (o: Partial<CandidateProject>): CandidateProject => ({
  name: "X", aliases: [], company: "Someone", minerals: ["Copper"], region: null, stageText: "exploration",
  greenfield: true, inChile: true, companyWebsite: null, quote: "q", confidence: 0.9, ...o,
});

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  db.prepare("UPDATE projects SET aliases = '[\"Viz\"]' WHERE slug = 'vizcachitas'").run();
  ensureProject(db, {
    slug: "cerro-negro", name: "Cerro Negro", owners: "Chilean junior mining interests", minerals: ["Cu"],
    region: "Antofagasta", stage: "exploration", stageText: "Exploration", stalled: false,
  });
  const id = (slug: string) => listProjects(db).find((p) => p.slug === slug)!.id;
  const suggestion = (name: string, status: string, region = "Atacama") =>
    Number(db.prepare("INSERT INTO suggestions (data, document_ids, status, created_at) VALUES (?, '[]', ?, '2026-09-01')")
      .run(JSON.stringify(cand({ name, region })), status).lastInsertRowid);
  return { db, id, suggestion };
}

describe("names", () => {
  it("folds accents, case, punctuation and filler words", () => {
    expect(foldName("Proyecto Vizcachitas")).toBe("vizcachitas");
    expect(foldName("VIZCACHITAS copper project")).toBe("vizcachitas copper");
    expect(foldName("NuevaUnión (Mina de Oro)")).toBe("nuevaunion oro");
  });

  it("matches equal names, contained names and mostly shared words", () => {
    expect(namesMatch("Proyecto Vizcachitas", "Vizcachitas")).toBe(true);
    expect(namesMatch("Salar Blanco", "Proyecto Blanco (Salar Blanco)")).toBe(true);
    expect(namesMatch("Cerro Azul Norte Sur", "Cerro Azul Norte")).toBe(true);
    expect(namesMatch("Cerro Azul", "Cerro Verde")).toBe(false);
  });

  it("keeps the distinctive words of an owner", () => {
    expect([...ownerWords("Barrick Mining Corporation / Newmont Corporation")].sort()).toEqual(["barrick", "newmont"]);
  });
});

describe("matchCandidate", () => {
  it("matches a tracked project under other spellings and its aliases", () => {
    const { db, id } = setup();
    for (const name of ["Proyecto Vizcachitas", "VIZCACHITAS copper project", "Viz"]) {
      expect(matchCandidate(db, cand({ name, region: "Valparaíso" }))).toEqual({ kind: "tracked", projectId: id("vizcachitas") });
    }
  });

  it("matches by a contained name plus the same region", () => {
    const { db } = setup();
    const blanco = listProjects(db).find((p) => p.slug.startsWith("proyecto-blanco"))!;
    expect(matchCandidate(db, cand({ name: "Salar Blanco", region: blanco.region }))).toEqual({ kind: "tracked", projectId: blanco.id });
  });

  it("flags a similar name in another region and owner as a possible duplicate only", () => {
    const { db, id } = setup();
    expect(matchCandidate(db, cand({ name: "Cerro Negro Norte", region: "Atacama", company: "CAP Minería" }))).toEqual({
      kind: "new", possibleDuplicateOf: id("cerro-negro"),
    });
  });

  it("matches a shared owner word instead of the region", () => {
    const { db, id } = setup();
    expect(matchCandidate(db, cand({ name: "Cerro Casale Sur", region: null, company: "Barrick Gold" }))).toEqual({
      kind: "tracked", projectId: id("cerro-casale"),
    });
  });

  it("finds pending and rejected suggestions, and reports nothing for a new name", () => {
    const { db, suggestion } = setup();
    const pending = suggestion("Cerro Azul", "pending");
    const rejected = suggestion("Lomas Bayas Sur", "rejected");
    expect(matchCandidate(db, cand({ name: "Proyecto Cerro Azul", region: "Atacama" }))).toEqual({ kind: "pending", suggestionId: pending });
    expect(matchCandidate(db, cand({ name: "LOMAS BAYAS SUR", region: "Antofagasta" }))).toEqual({ kind: "rejected", suggestionId: rejected });
    expect(matchCandidate(db, cand({ name: "Quebrada Seca", region: "Coquimbo" }))).toEqual({ kind: "new", possibleDuplicateOf: null });
  });
});

describe("matchCandidate caution", () => {
  it("does not treat the same name in another region with another owner as the same project", () => {
    const { db, id } = setup();
    const neg = id("cerro-negro");
    expect(matchCandidate(db, cand({ name: "Cerro Negro Norte", aliases: ["Cerro Negro"], region: "Atacama", company: "CAP Minería" })))
      .toEqual({ kind: "new", possibleDuplicateOf: neg });
    expect(matchCandidate(db, cand({ name: "Cerro Negro", region: "Atacama", company: "CAP Minería" })))
      .toEqual({ kind: "new", possibleDuplicateOf: neg });
    // With nothing to contradict it, the same name is still the same project.
    expect(matchCandidate(db, cand({ name: "Cerro Negro", region: null, company: "Unknown" }))).toEqual({ kind: "tracked", projectId: neg });
  });

  it("does not match on shared mineral, place-type or company words", () => {
    const { db } = setup();
    ensureProject(db, {
      slug: "pampa-blanca", name: "Pampa Blanca Copper-Gold Project", owners: "Junior mining company", minerals: ["Cu", "Au"],
      region: "Antofagasta", stage: "exploration", stageText: "", stalled: false,
    });
    ensureProject(db, {
      slug: "taltal", name: "Taltal Copper-Gold Prospect", owners: "Exploration-focused project owner", minerals: ["Cu"],
      region: "Antofagasta", stage: "exploration", stageText: "", stalled: false,
    });
    expect(matchCandidate(db, cand({ name: "Pampa Norte Copper-Gold Project", region: "Antofagasta" })).kind).toBe("new");
    expect(matchCandidate(db, cand({ name: "Taltal Copper-Gold Prospect Norte", region: "Atacama", company: "Andes Exploration Corp" })).kind).toBe("new");
  });

  it("compares regions written differently", () => {
    const { db, id } = setup();
    expect(matchCandidate(db, cand({ name: "Cerro Negro Sur", region: "Región de Antofagasta" }))).toEqual({ kind: "tracked", projectId: id("cerro-negro") });
    expect(matchCandidate(db, cand({ name: "Cerro Negro Sur", region: "II Región de Antofagasta" }))).toEqual({ kind: "tracked", projectId: id("cerro-negro") });
  });
});
