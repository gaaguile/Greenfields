import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.ts";
import { candidate } from "../helpers/candidate.ts";
import { upsertDocument } from "../../src/store/documents.ts";
import { buildPublicData } from "../../src/publish/buildPublicData.ts";
import { ensureProject, listProjects } from "../../src/store/projects.ts";
import {
  addDocumentToSuggestion, approveSuggestion, createSuggestion, getSuggestion, listSuggestions, mergeSuggestion, rejectSuggestion,
} from "../../src/store/suggestions.ts";

const AT = "2026-10-29T15:00:00.000Z";


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

describe("deciding suggestions", () => {
  function setup() {
    const db = openDb(":memory:");
    const d1 = upsertDocument(db, { url: "https://x.com/1", status: "done" });
    const id = createSuggestion(db, candidate({ aliases: ["Azul Project"] }), d1, null, "2026-10-29T12:00:00.000Z");
    const projects = () => listProjects(db);
    const docStatus = () => db.prepare("SELECT status, project_id FROM documents WHERE id = ?").get(d1) as { status: string; project_id: number | null };
    return { db, id, d1, projects, docStatus };
  }
  const edits = { name: "Cerro Azul", owners: "Andes Exploration Corp.", minerals: ["Copper", "Gold"], region: "Atacama", stageText: "Early-stage exploration" };

  it("approve creates the project with its other names and hands it the documents", () => {
    const { db, id, projects, docStatus } = setup();
    const { projectId, slug } = approveSuggestion(db, id, edits, AT);
    expect(slug).toBe("cerro-azul");
    expect(projects().find((p) => p.id === projectId)).toMatchObject({
      name: "Cerro Azul", owners: "Andes Exploration Corp.", region: "Atacama", stage: "exploration", aliases: ["Azul Project"],
    });
    expect(docStatus()).toEqual({ status: "triaged", project_id: projectId });
    expect(getSuggestion(db, id)!.status).toBe("approved");
    expect(buildPublicData(db, AT, 7).projects.map((p) => p.slug)).toContain("cerro-azul");
  });

  it("refuses a name that is already a project", () => {
    const { db, id } = setup();
    ensureProject(db, { slug: "cerro-azul", name: "Cerro Azul", owners: "", minerals: [], region: "", stage: "exploration", stageText: "", stalled: false });
    expect(() => approveSuggestion(db, id, edits, AT)).toThrow("a project with this name already exists");
  });

  it("merge adds the names once and hands the documents to the project", () => {
    const { db, id, projects, docStatus } = setup();
    const { id: target } = ensureProject(db, {
      slug: "cerro-azul-norte", name: "Cerro Azul Norte", owners: "", minerals: [], region: "Atacama", stage: "exploration", stageText: "", stalled: false,
    });
    db.prepare("UPDATE projects SET aliases = '[\"cerro azul\"]' WHERE id = ?").run(target);
    mergeSuggestion(db, id, target, AT);
    expect(projects().find((p) => p.id === target)!.aliases).toEqual(["cerro azul", "Azul Project"]);
    expect(docStatus()).toEqual({ status: "triaged", project_id: target });
    expect(getSuggestion(db, id)!.status).toBe("merged");
  });

  it("reject is remembered and a decided suggestion cannot be decided again", () => {
    const { db, id } = setup();
    rejectSuggestion(db, id, AT);
    expect(getSuggestion(db, id)!.status).toBe("rejected");
    expect(() => rejectSuggestion(db, id, AT)).toThrow("not pending");
    expect(() => approveSuggestion(db, id, edits, AT)).toThrow("not pending");
  });
});
