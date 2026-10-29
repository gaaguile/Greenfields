import { describe, expect, it } from "vitest";
import type { CandidateProject } from "../../src/pipeline/candidate.ts";
import { openDb } from "../../src/store/db.ts";
import { upsertDocument } from "../../src/store/documents.ts";
import { addDocumentToSuggestion, createSuggestion, getSuggestion, listSuggestions } from "../../src/store/suggestions.ts";

export const candidate = (o: Partial<CandidateProject> = {}): CandidateProject => ({
  name: "Cerro Azul", aliases: [], company: "Andes Exploration Corp.", minerals: ["Copper", "Gold"], region: "Atacama",
  stageText: "Early-stage exploration", greenfield: true, inChile: true, companyWebsite: null,
  quote: "Cerro Azul project is an early-stage exploration project", confidence: 0.85, ...o,
});

describe("suggestions store", () => {
  it("creates, attaches documents once and lists by status", () => {
    const db = openDb(":memory:");
    const d1 = upsertDocument(db, { url: "https://x.com/1", status: "done" });
    const d2 = upsertDocument(db, { url: "https://x.com/2", status: "done" });
    const id = createSuggestion(db, candidate(), d1, null, "2026-10-29T12:00:00.000Z");
    addDocumentToSuggestion(db, id, d2);
    addDocumentToSuggestion(db, id, d2);
    expect(getSuggestion(db, id)).toMatchObject({ id, documentIds: [d1, d2], duplicateOf: null, status: "pending", data: { name: "Cerro Azul" } });
    expect(listSuggestions(db, "pending").map((s) => s.id)).toEqual([id]);
    expect(listSuggestions(db, "rejected")).toEqual([]);
  });
});
