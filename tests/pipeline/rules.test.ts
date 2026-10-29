import { describe, expect, it } from "vitest";
import type { FieldValueRow } from "../../src/domain/types.ts";
import type { ProposedFigure } from "../../src/pipeline/extract.ts";
import { applyFigures, decide, type SourcedFigure } from "../../src/pipeline/rules.ts";
import { openDb } from "../../src/store/db.ts";
import { ensureProject } from "../../src/store/projects.ts";
import { getPublished, insertFieldValue, publishFieldValue } from "../../src/store/fieldValues.ts";
import { upsertDocument } from "../../src/store/documents.ts";

const fig = (o: Partial<ProposedFigure> = {}): ProposedFigure => ({
  field: "capex_usd", valueText: "US$2.7 billion", valueNum: 2.7e9, unit: "USD", basis: "100%",
  attributableShare: null, figureDate: null, confidence: 0.9, quote: "initial capital costs of US$2.7 billion", ...o,
});

const current = (o: Partial<FieldValueRow> = {}): FieldValueRow => ({
  id: 1, projectId: 1, field: "capex_usd", valueText: "US$2.4 billion", valueNum: 2.4e9, unit: "USD", basis: "100%",
  attributableShare: null, figureDate: null, documentId: null, quote: null, confidence: null, status: "published",
  decidedBy: "auto", createdAt: "", decidedAt: "", holdReason: null, ...o,
});

const ctx = { material: true, conflict: false, minConfidence: 0.8, numericThreshold: 0.2 };

describe("decide", () => {
  it("publishes a confident new field from a material document", () => {
    expect(decide(fig(), undefined, ctx)).toEqual({ action: "publish" });
  });

  it("publishes a numeric change within ±20%", () => {
    expect(decide(fig({ valueText: "US$2.7 billion", valueNum: 2.7e9 }), current(), ctx)).toEqual({ action: "publish" });
  });

  it("compares units written differently as the same unit", () => {
    expect(decide(fig({ unit: "US$" }), current({ unit: "USD" }), ctx)).toEqual({ action: "publish" });
    expect(decide(fig({ field: "mine_life_years", valueText: "28 yrs", valueNum: 28, unit: "yrs" }),
      current({ field: "mine_life_years", valueText: "26 years", valueNum: 26, unit: "years" }), ctx)).toEqual({ action: "publish" });
  });

  it("holds a change beyond ±20%", () => {
    expect(decide(fig({ valueText: "US$3.0 billion", valueNum: 3.0e9 }), current(), ctx)).toEqual({
      action: "hold", reason: "change beyond ±20%",
    });
  });

  it("holds low confidence", () => {
    expect(decide(fig({ confidence: 0.7 }), current(), ctx)).toEqual({ action: "hold", reason: "low confidence" });
  });

  it("always holds stage, owners and minerals", () => {
    for (const field of ["stage", "owners", "minerals"] as const) {
      expect(decide(fig({ field, valueText: "x", valueNum: null, unit: null }), undefined, ctx)).toEqual({
        action: "hold", reason: "stage/owner/mineral change",
      });
    }
  });

  it("holds a text change to a field that already has a value", () => {
    const reserve = { field: "reserve_headline" as const, valueNum: null, unit: null };
    expect(decide(fig({ ...reserve, valueText: "1.3 Bt @ 0.36% Cu" }), current({ ...reserve, valueText: "1.22 Bt @ 0.36% Cu" }), ctx))
      .toEqual({ action: "hold", reason: "text change" });
    expect(decide(fig({ valueNum: null }), current(), ctx)).toEqual({ action: "hold", reason: "text change" });
  });

  it("holds numbers it cannot compare because the units differ", () => {
    // "US$1.2 bn" reported as 1.2 with unit "billion USD" against a value stored in plain dollars.
    expect(decide(fig({ valueText: "US$1.2 bn", valueNum: 1.2, unit: "billion USD" }), current(), ctx)).toEqual({
      action: "hold", reason: "units differ",
    });
    expect(decide(fig({ unit: null }), current(), ctx)).toEqual({ action: "hold", reason: "units differ" });
  });

  it("holds when the old value is zero", () => {
    expect(decide(fig(), current({ valueNum: 0, valueText: "0" }), ctx)).toEqual({ action: "hold", reason: "change beyond ±20%" });
  });

  it("holds figures from an immaterial document", () => {
    expect(decide(fig(), undefined, { ...ctx, material: false })).toEqual({ action: "hold", reason: "immaterial document" });
  });

  it("holds conflicting figures", () => {
    expect(decide(fig(), undefined, { ...ctx, conflict: true })).toEqual({ action: "hold", reason: "conflicting sources" });
  });

  it("skips a value equal to the published one", () => {
    expect(decide(fig({ valueText: " us$2.4  BILLION", valueNum: 2.4e9 }), current(), ctx)).toEqual({ action: "skip", reason: "unchanged" });
    // Same number in the same unit, worded differently.
    expect(decide(fig({ valueText: "US$2,400 million", valueNum: 2.4e9 }), current(), ctx)).toEqual({ action: "skip", reason: "unchanged" });
  });
});

describe("applyFigures", () => {
  function setup() {
    const db = openDb(":memory:");
    const { id: projectId } = ensureProject(db, {
      slug: "p", name: "P", owners: "O", minerals: ["Cu"], region: "Atacama", stage: "pfs", stageText: "PFS", stalled: false,
    });
    const old = insertFieldValue(db, { projectId, field: "capex_usd", valueText: "US$2.4 billion", valueNum: 2.4e9, unit: "USD", status: "pending" });
    publishFieldValue(db, old, "owner", "2026-09-01T00:00:00Z");
    const doc1 = upsertDocument(db, { url: "https://x.com/1", status: "extracted" });
    const doc2 = upsertDocument(db, { url: "https://x.com/2", status: "extracted" });
    const rows = () => db.prepare("SELECT * FROM field_values ORDER BY id").all() as Record<string, unknown>[];
    return { db, projectId, doc1, doc2, rows };
  }
  const settings = { minConfidence: 0.8, numericThreshold: 0.2 };
  const sourced = (o: Partial<SourcedFigure>, documentId: number): SourcedFigure => ({ ...fig(o), documentId, material: true });

  it("publishes and holds with the source document, quote and confidence, superseding only on publish", () => {
    const { db, projectId, doc1, rows } = setup();
    const r = applyFigures(db, projectId, [
      sourced({}, doc1),
      sourced({ field: "mine_life_years", valueText: "28 years", valueNum: 28, unit: "years", quote: "a mine life of 28 years", confidence: 0.5 }, doc1),
    ], settings, "2026-10-28T12:00:00Z");
    expect(r).toEqual({ published: 1, held: 1, skipped: 0 });
    const all = rows();
    expect(all.map((x) => x.status)).toEqual(["superseded", "published", "pending"]);
    expect(all[1]).toMatchObject({ document_id: doc1, quote: "initial capital costs of US$2.7 billion", confidence: 0.9, decided_by: "auto" });
    expect(all[2]).toMatchObject({ document_id: doc1, hold_reason: "low confidence", decided_by: null });
  });

  it("holds both figures when two documents disagree in the same run", () => {
    const { db, projectId, doc1, doc2, rows } = setup();
    const r = applyFigures(db, projectId, [
      sourced({}, doc1),
      sourced({ valueText: "US$2.6 billion", valueNum: 2.6e9, quote: "capital costs of US$2.6 billion overall" }, doc2),
    ], settings, "2026-10-28T12:00:00Z");
    expect(r).toEqual({ published: 0, held: 2, skipped: 0 });
    expect(rows().filter((x) => x.hold_reason === "conflicting sources")).toHaveLength(2);
  });

  it("publishes the same value from two documents only once", () => {
    const { db, projectId, doc1, doc2 } = setup();
    const r = applyFigures(db, projectId, [sourced({}, doc1), sourced({}, doc2)], settings, "2026-10-28T12:00:00Z");
    expect(r).toEqual({ published: 1, held: 0, skipped: 1 });
    expect(getPublished(db, projectId).find((v) => v.field === "capex_usd")!.valueText).toBe("US$2.7 billion");
  });
});

describe("decide: basis and dates", () => {
  it("holds a figure on a different basis than the published one", () => {
    expect(decide(fig({ basis: "attributable", attributableShare: 0.85, valueNum: 2.3e9, valueText: "US$2.3 billion" }), current(), ctx))
      .toEqual({ action: "hold", reason: "basis differs" });
  });

  it("holds a figure dated before the published one", () => {
    expect(decide(fig({ figureDate: "2019-03-01" }), current({ figureDate: "2025-06-01" }), ctx))
      .toEqual({ action: "hold", reason: "older than published" });
  });

  it("holds an undated figure when the published one has a date", () => {
    expect(decide(fig({ figureDate: null }), current({ figureDate: "2025-06-01" }), ctx))
      .toEqual({ action: "hold", reason: "older than published" });
  });
});

describe("applyFigures: project fields and repeated holds", () => {
  function setupProject() {
    const db = openDb(":memory:");
    const { id: projectId } = ensureProject(db, {
      slug: "p", name: "P", owners: "Los Andes Copper", minerals: ["Cu", "Mo"], region: "Valparaíso", stage: "pfs",
      stageText: "Pre-Feasibility Study (PFS) completed", stalled: false,
    });
    const doc = upsertDocument(db, { url: "https://x.com/1", status: "extracted" });
    const pending = () => db.prepare("SELECT field, value_text FROM field_values WHERE status = 'pending'").all();
    return { db, projectId, doc, pending };
  }
  const settings = { minConfidence: 0.8, numericThreshold: 0.2 };
  const sourced = (o: Partial<SourcedFigure>, documentId: number): SourcedFigure => ({ ...fig(o), documentId, material: true });
  const text = (field: "stage" | "owners" | "minerals", valueText: string, doc: number) =>
    sourced({ field, valueText, valueNum: null, unit: null, quote: "q".repeat(20) }, doc);

  it("skips stage, owners and minerals that match the project", () => {
    const { db, projectId, doc, pending } = setupProject();
    const r = applyFigures(db, projectId, [
      text("stage", "Pre-feasibility study", doc),
      text("owners", "los andes copper", doc),
      text("minerals", "Copper, Molybdenum", doc),
      text("minerals", "Copper and Molybdenum", doc),
    ], settings, "2026-10-28T12:00:00Z");
    expect(r).toEqual({ published: 0, held: 0, skipped: 4 });
    expect(pending()).toEqual([]);
  });

  it("holds a real stage change only once, however often it is seen", () => {
    const { db, projectId, doc, pending } = setupProject();
    applyFigures(db, projectId, [text("stage", "Feasibility study", doc)], settings, "2026-10-28T12:00:00Z");
    const again = applyFigures(db, projectId, [text("stage", "Feasibility study", doc)], settings, "2026-10-29T12:00:00Z");
    expect(again).toEqual({ published: 0, held: 0, skipped: 1 });
    expect(pending()).toHaveLength(1);
  });

  it("does not add a second pending row for a held figure seen again", () => {
    const { db, projectId, doc, pending } = setupProject();
    const low = sourced({ confidence: 0.5 }, doc);
    applyFigures(db, projectId, [low], settings, "2026-10-28T12:00:00Z");
    applyFigures(db, projectId, [low], settings, "2026-10-29T12:00:00Z");
    expect(pending()).toHaveLength(1);
  });
});
