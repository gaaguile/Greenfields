import type { DatabaseSync } from "node:sqlite";

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
