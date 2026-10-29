import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export type SourceKind = "ir_news" | "seia" | "cochilco" | "news_feed" | "newswire";
export type SourceHealth = "ok" | "unhealthy" | "changed";

export interface SourceRow {
  id: number;
  url: string;
  kind: SourceKind;
  projectId: number | null;
  company: string | null;
  render: boolean;
  lastCheckedAt: string | null;
  firstCheckedAt: string | null;
  fingerprint: string | null;
  failureCount: number;
  health: SourceHealth;
  lastError: string | null;
}

export interface NewSource {
  url: string;
  kind: SourceKind;
  projectSlug?: string;
  company?: string;
  render?: boolean;
}

export type CheckResult =
  | { ok: true; fingerprint: string; linksFound: number; at: string; layoutChanged?: boolean }
  | { ok: false; error: string; at: string };

const UNHEALTHY_AFTER = 3;

export function addSource(db: DatabaseSync, s: NewSource): number {
  const existing = db.prepare("SELECT id FROM sources WHERE url = ?").get(s.url) as { id: number } | undefined;
  if (existing) return existing.id;
  let projectId: number | null = null;
  if (s.projectSlug) {
    const p = db.prepare("SELECT id FROM projects WHERE slug = ?").get(s.projectSlug) as { id: number } | undefined;
    if (!p) throw new Error(`unknown project: ${s.projectSlug}`);
    projectId = p.id;
  }
  const result = db
    .prepare("INSERT INTO sources (url, kind, project_id, company, render) VALUES (?, ?, ?, ?, ?)")
    .run(s.url, s.kind, projectId, s.company ?? null, s.render ? 1 : 0);
  return Number(result.lastInsertRowid);
}

interface SourceDbRow {
  id: number; url: string; kind: string; project_id: number | null; company: string | null; render: number;
  last_checked_at: string | null; first_checked_at: string | null; fingerprint: string | null;
  failure_count: number; health: string; last_error: string | null;
}

function toSourceRow(r: SourceDbRow): SourceRow {
  return {
    id: r.id,
    url: r.url,
    kind: r.kind as SourceKind,
    projectId: r.project_id,
    company: r.company,
    render: r.render === 1,
    lastCheckedAt: r.last_checked_at,
    firstCheckedAt: r.first_checked_at,
    fingerprint: r.fingerprint,
    failureCount: r.failure_count,
    health: r.health as SourceHealth,
    lastError: r.last_error,
  };
}

// activeOnly leaves out sources whose project is paused; company-wide sources are always kept.
export function listSources(db: DatabaseSync, opts: { activeOnly?: boolean } = {}): SourceRow[] {
  const sql = opts.activeOnly
    ? `SELECT s.* FROM sources s LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.project_id IS NULL OR p.tracking = 'active' ORDER BY s.id`
    : "SELECT * FROM sources ORDER BY id";
  return (db.prepare(sql).all() as unknown as SourceDbRow[]).map(toSourceRow);
}

export function recordCheck(db: DatabaseSync, id: number, r: CheckResult): void {
  if (r.ok) {
    // The first check only counts once it has seen links, so a page that loaded empty keeps its baseline for later.
    db.prepare(
      `UPDATE sources SET last_checked_at = ?, first_checked_at = COALESCE(first_checked_at, ?), fingerprint = ?,
         failure_count = 0, last_error = NULL, health = ? WHERE id = ?`,
    ).run(
      r.at, r.linksFound > 0 ? r.at : null, r.fingerprint,
      r.linksFound === 0 || r.layoutChanged ? "changed" : "ok", id,
    );
  } else {
    db.prepare(
      `UPDATE sources SET last_checked_at = ?, failure_count = failure_count + 1, last_error = ?,
         health = CASE WHEN failure_count + 1 >= ? THEN 'unhealthy' ELSE health END WHERE id = ?`,
    ).run(r.at, r.error, UNHEALTHY_AFTER, id);
  }
}

interface SourceFileEntry {
  url: string;
  kind: SourceKind;
  project?: string;
  company?: string;
  render?: boolean;
}

export function syncSourcesFile(db: DatabaseSync, file: string): { added: number } {
  const entries = JSON.parse(readFileSync(file, "utf8")) as SourceFileEntry[];
  const before = listSources(db).length;
  for (const e of entries) {
    addSource(db, { url: e.url, kind: e.kind, projectSlug: e.project, company: e.company, render: e.render });
  }
  return { added: listSources(db).length - before };
}
