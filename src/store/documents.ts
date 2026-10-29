import type { DatabaseSync } from "node:sqlite";
import type { DocumentStatus } from "../domain/types.ts";

export function upsertDocument(
  db: DatabaseSync,
  d: { url: string; title?: string; publishedAt?: string; status: string },
): number {
  const existing = db.prepare("SELECT id FROM documents WHERE url = ?").get(d.url) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare("INSERT INTO documents (url, title, published_at, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(d.url, d.title ?? null, d.publishedAt ?? null, d.status, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function getDocumentUrl(db: DatabaseSync, id: number): { url: string; title: string | null } | undefined {
  return db.prepare("SELECT url, title FROM documents WHERE id = ?").get(id) as
    | { url: string; title: string | null }
    | undefined;
}

export interface DocumentRow {
  id: number;
  url: string;
  sourceId: number | null;
  projectId: number | null;
  title: string | null;
  text: string | null;
  triage: string | null;
  status: DocumentStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface DocumentDbRow {
  id: number; url: string; source_id: number | null; project_id: number | null; title: string | null;
  text: string | null; triage: string | null; status: string; error: string | null; created_at: string;
  updated_at: string | null;
}

const toDocumentRow = (r: DocumentDbRow): DocumentRow => ({
  id: r.id,
  url: r.url,
  sourceId: r.source_id,
  projectId: r.project_id,
  title: r.title,
  text: r.text,
  triage: r.triage,
  status: r.status as DocumentStatus,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Returns null when the URL is already known, so a link is only ever processed once.
export function addFoundDocument(
  db: DatabaseSync,
  d: { url: string; title: string; sourceId: number; projectId: number | null; status: "found" | "skipped" },
): number | null {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO documents (url, title, source_id, project_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING`,
    )
    .run(d.url, d.title, d.sourceId, d.projectId, d.status, now, now);
  return result.changes ? Number(result.lastInsertRowid) : null;
}

export function setDocumentStatus(
  db: DatabaseSync,
  id: number,
  status: DocumentStatus,
  patch: { text?: string; triage?: string; error?: string | null; projectId?: number | null; title?: string } = {},
): void {
  const sets = ["status = ?", "updated_at = ?"];
  const values: (string | number | null)[] = [status, new Date().toISOString()];
  const columns: [keyof typeof patch, string][] = [
    ["text", "text"], ["triage", "triage"], ["error", "error"], ["projectId", "project_id"], ["title", "title"],
  ];
  for (const [key, column] of columns) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(patch[key] as string | number | null);
    }
  }
  db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
}

export function listDocumentsByStatus(db: DatabaseSync, statuses: DocumentStatus[]): DocumentRow[] {
  const rows = db
    .prepare(`SELECT * FROM documents WHERE status IN (${statuses.map(() => "?").join(", ")}) ORDER BY id`)
    .all(...statuses) as unknown as DocumentDbRow[];
  return rows.map(toDocumentRow);
}

const MAX_ATTEMPTS = 5;

// A temporary error leaves the document where it is for the next run; after 5 tries it is marked failed.
export function recordTransientFailure(db: DatabaseSync, id: number, error: string): "retry" | "failed" {
  db.prepare("UPDATE documents SET attempts = attempts + 1, error = ?, updated_at = ? WHERE id = ?").run(
    error, new Date().toISOString(), id,
  );
  const { attempts } = db.prepare("SELECT attempts FROM documents WHERE id = ?").get(id) as { attempts: number };
  if (attempts < MAX_ATTEMPTS) return "retry";
  setDocumentStatus(db, id, "failed");
  return "failed";
}
