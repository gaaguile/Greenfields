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

// Only finished runs count: a run that crashed part-way is caught up after the restart.
export function lastRunStartedAt(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT MAX(started_at) AS at FROM runs WHERE ended_at IS NOT NULL").get() as { at: string | null };
  return row.at;
}

const LOCK_KEY = "run_lock";

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// One pipeline run at a time across processes (the daemon and a manual run-once).
export function acquireRunLock(db: DatabaseSync, pid: number, at: string): { ok: true } | { ok: false; holder: number } {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(LOCK_KEY) as { value: string } | undefined;
    const holder = row ? (JSON.parse(row.value) as { pid: number }).pid : null;
    if (holder !== null && holder !== pid && processAlive(holder)) {
      db.exec("COMMIT");
      return { ok: false, holder };
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      LOCK_KEY, JSON.stringify({ pid, at }),
    );
    db.exec("COMMIT");
    return { ok: true };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function releaseRunLock(db: DatabaseSync, pid: number): void {
  db.prepare("DELETE FROM meta WHERE key = ? AND json_extract(value, '$.pid') = ?").run(LOCK_KEY, pid);
}
