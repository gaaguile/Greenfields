import type { DatabaseSync } from "node:sqlite";
import type { StageCategory } from "../domain/stage.ts";
import type { NewProject, ProjectRow } from "../domain/types.ts";

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function upsertProject(db: DatabaseSync, p: NewProject): { id: number; created: boolean } {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM projects WHERE slug = ?").get(p.slug) as { id: number } | undefined;
  const values = [
    p.name, p.owners, JSON.stringify(p.minerals), p.region, p.province ?? null, p.locationDetail ?? null,
    p.stage, p.stageText, p.stalled ? 1 : 0,
  ];
  if (existing) {
    db.prepare(
      `UPDATE projects SET name = ?, owners = ?, minerals = ?, region = ?, province = ?, location_detail = ?,
         stage = ?, stage_text = ?, stalled = ?, updated_at = ? WHERE id = ?`,
    ).run(...values, now, existing.id);
    return { id: existing.id, created: false };
  }
  const result = db.prepare(
    `INSERT INTO projects (name, owners, minerals, region, province, location_detail, stage, stage_text, stalled,
       slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...values, p.slug, now, now);
  return { id: Number(result.lastInsertRowid), created: true };
}

interface ProjectDbRow {
  id: number; slug: string; name: string; aliases: string; owners: string; minerals: string; region: string;
  province: string | null; location_detail: string | null; stage: string; stage_text: string; stalled: number;
  tracking: string; created_at: string; updated_at: string;
}

function toProjectRow(r: ProjectDbRow): ProjectRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    aliases: JSON.parse(r.aliases),
    owners: r.owners,
    minerals: JSON.parse(r.minerals),
    region: r.region,
    province: r.province,
    locationDetail: r.location_detail,
    stage: r.stage as StageCategory,
    stageText: r.stage_text,
    stalled: r.stalled === 1,
    tracking: r.tracking as ProjectRow["tracking"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listProjects(db: DatabaseSync, opts: { tracking?: "active" | "paused" } = {}): ProjectRow[] {
  const rows = opts.tracking
    ? db.prepare("SELECT * FROM projects WHERE tracking = ? ORDER BY name").all(opts.tracking)
    : db.prepare("SELECT * FROM projects ORDER BY name").all();
  return (rows as unknown as ProjectDbRow[]).map(toProjectRow);
}
