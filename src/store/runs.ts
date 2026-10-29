import type { DatabaseSync } from "node:sqlite";

export type RunTrigger = "schedule" | "manual" | "catch-up";

export function startRun(db: DatabaseSync, trigger: RunTrigger, at: string): number {
  return Number(db.prepare("INSERT INTO runs (started_at, trigger) VALUES (?, ?)").run(at, trigger).lastInsertRowid);
}

export function finishRun(
  db: DatabaseSync,
  id: number,
  r: { counts: object; errors: string[]; postponed: boolean; published: boolean; at: string },
): void {
  db.prepare("UPDATE runs SET ended_at = ?, counts = ?, errors = ?, postponed = ?, published = ? WHERE id = ?").run(
    r.at, JSON.stringify(r.counts), JSON.stringify(r.errors), r.postponed ? 1 : 0, r.published ? 1 : 0, id,
  );
}

export function lastRunStartedAt(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT MAX(started_at) AS at FROM runs").get() as { at: string | null };
  return row.at;
}
