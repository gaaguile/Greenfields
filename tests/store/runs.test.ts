import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.ts";
import { acquireRunLock, finishRun, lastRunStartedAt, releaseRunLock, startRun } from "../../src/store/runs.ts";

describe("runs store", () => {
  it("returns null before any run", () => {
    expect(lastRunStartedAt(openDb(":memory:"))).toBeNull();
  });

  it("returns the newest start time of a finished run and stores the finished run", () => {
    const db = openDb(":memory:");
    const first = startRun(db, "schedule", "2026-10-27T07:00:00.000Z");
    finishRun(db, first, { counts: {}, errors: [], postponed: false, published: false, at: "2026-10-27T07:05:00.000Z" });
    const id = startRun(db, "catch-up", "2026-10-28T08:00:00.000Z");
    // A run that never finished (a crash) does not count, so the slot is caught up after a restart.
    expect(lastRunStartedAt(db)).toBe("2026-10-27T07:00:00.000Z");
    finishRun(db, id, { counts: { published: 2 }, errors: ["x"], postponed: true, published: false, at: "2026-10-28T08:05:00.000Z" });
    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ trigger: "catch-up", ended_at: "2026-10-28T08:05:00.000Z", postponed: 1, published: 0 });
    expect(JSON.parse(row.counts as string)).toEqual({ published: 2 });
    expect(JSON.parse(row.errors as string)).toEqual(["x"]);
    expect(lastRunStartedAt(db)).toBe("2026-10-28T08:00:00.000Z");
  });
});

describe("run lock", () => {
  it("lets one holder in at a time and frees the lock of a dead process", () => {
    const db = openDb(":memory:");
    expect(acquireRunLock(db, process.ppid, "2026-10-28T08:00:00.000Z")).toEqual({ ok: true });
    expect(acquireRunLock(db, process.pid, "2026-10-28T08:01:00.000Z")).toEqual({ ok: false, holder: process.ppid });
    releaseRunLock(db, process.ppid);
    expect(acquireRunLock(db, process.pid, "2026-10-28T08:02:00.000Z")).toEqual({ ok: true });
    // A crashed holder (no such process) does not block the next run.
    const db2 = openDb(":memory:");
    acquireRunLock(db2, 2_000_000_000, "2026-10-28T08:00:00.000Z");
    expect(acquireRunLock(db2, process.pid, "2026-10-28T08:01:00.000Z")).toEqual({ ok: true });
  });
});
