import type { DatabaseSync } from "node:sqlite";
import { normalizeStage } from "../domain/stage.ts";
import type { CandidateProject } from "../pipeline/candidate.ts";
import { ensureProject, slugify } from "./projects.ts";

export type SuggestionStatus = "pending" | "approved" | "merged" | "rejected";

export interface SuggestionRow {
  id: number;
  data: CandidateProject;
  documentIds: number[];
  // A tracked project with a similar name, shown as a warning.
  duplicateOf: number | null;
  status: SuggestionStatus;
  createdAt: string;
}

interface SuggestionDbRow {
  id: number; data: string; document_ids: string; duplicate_of: number | null; status: string; created_at: string;
}

const toRow = (r: SuggestionDbRow): SuggestionRow => ({
  id: r.id,
  data: JSON.parse(r.data) as CandidateProject,
  documentIds: JSON.parse(r.document_ids) as number[],
  duplicateOf: r.duplicate_of,
  status: r.status as SuggestionStatus,
  createdAt: r.created_at,
});

export function createSuggestion(
  db: DatabaseSync,
  c: CandidateProject,
  documentId: number,
  duplicateOf: number | null,
  at: string,
): number {
  return Number(
    db.prepare("INSERT INTO suggestions (data, document_ids, duplicate_of, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(JSON.stringify(c), JSON.stringify([documentId]), duplicateOf, at).lastInsertRowid,
  );
}

export function getSuggestion(db: DatabaseSync, id: number): SuggestionRow | undefined {
  const r = db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id) as SuggestionDbRow | undefined;
  return r ? toRow(r) : undefined;
}

export function listSuggestions(db: DatabaseSync, status: SuggestionStatus): SuggestionRow[] {
  return (db.prepare("SELECT * FROM suggestions WHERE status = ? ORDER BY created_at, id").all(status) as unknown as SuggestionDbRow[])
    .map(toRow);
}

// More evidence for the same suggestion; its details stay as first suggested.
export function addDocumentToSuggestion(db: DatabaseSync, id: number, documentId: number): void {
  const s = getSuggestion(db, id);
  if (!s || s.documentIds.includes(documentId)) return;
  db.prepare("UPDATE suggestions SET document_ids = ? WHERE id = ?").run(JSON.stringify([...s.documentIds, documentId]), id);
}

function pending(db: DatabaseSync, id: number): SuggestionRow {
  const s = getSuggestion(db, id);
  if (!s || s.status !== "pending") throw new Error(`suggestion ${id} is not pending`);
  return s;
}

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const setStatus = (db: DatabaseSync, id: number, status: SuggestionStatus) =>
  db.prepare("UPDATE suggestions SET status = ? WHERE id = ?").run(status, id);

// The suggestion's documents are extracted for the project at the next run (news figures are held for review).
function handDocuments(db: DatabaseSync, s: SuggestionRow, projectId: number, at: string) {
  const move = db.prepare("UPDATE documents SET project_id = ?, status = 'triaged', updated_at = ? WHERE id = ?");
  for (const docId of s.documentIds) move.run(projectId, at, docId);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Creates the project from the owner's (possibly edited) details.
export function approveSuggestion(
  db: DatabaseSync,
  id: number,
  edits: { name: string; owners: string; minerals: string[]; region: string; stageText: string; aliases?: string[] },
  at: string,
): { projectId: number; slug: string } {
  return inTransaction(db, () => {
    const s = pending(db, id);
    const slug = slugify(edits.name);
    if (!slug) throw new Error("a name is required");
    const { stage, stalled } = normalizeStage(edits.stageText);
    const { id: projectId, created } = ensureProject(db, {
      slug, name: edits.name.trim(), owners: edits.owners.trim(), minerals: edits.minerals, region: edits.region.trim(),
      stage, stageText: edits.stageText.trim(), stalled,
    });
    if (!created) throw new Error("a project with this name already exists");
    const aliases = [s.data.name, ...(edits.aliases ?? s.data.aliases)].filter((n, i, all) =>
      !sameName(n, edits.name) && all.findIndex((m) => sameName(m, n)) === i);
    db.prepare("UPDATE projects SET aliases = ? WHERE id = ?").run(JSON.stringify(aliases), projectId);
    handDocuments(db, s, projectId, at);
    setStatus(db, id, "approved");
    return { projectId, slug };
  });
}

// The suggestion is a project we already track under another name.
export function mergeSuggestion(db: DatabaseSync, id: number, projectId: number, at: string): void {
  inTransaction(db, () => {
    const s = pending(db, id);
    const p = db.prepare("SELECT name, aliases FROM projects WHERE id = ?").get(projectId) as { name: string; aliases: string } | undefined;
    if (!p) throw new Error(`project ${projectId} not found`);
    const aliases = JSON.parse(p.aliases) as string[];
    for (const n of [s.data.name, ...s.data.aliases]) {
      if (!sameName(n, p.name) && !aliases.some((a) => sameName(a, n))) aliases.push(n);
    }
    db.prepare("UPDATE projects SET aliases = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(aliases), at, projectId);
    handDocuments(db, s, projectId, at);
    setStatus(db, id, "merged");
  });
}

// Remembered: later news about the same project attaches here instead of suggesting it again.
export function rejectSuggestion(db: DatabaseSync, id: number, _at: string): void {
  pending(db, id);
  setStatus(db, id, "rejected");
}
