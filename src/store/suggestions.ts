import type { DatabaseSync } from "node:sqlite";
import type { CandidateProject } from "../pipeline/candidate.ts";

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
