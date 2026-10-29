import { describe, expect, it } from "vitest";
import { openDb } from "../../src/store/db.ts";
import { finishRun, lastRunStartedAt, startRun } from "../../src/store/runs.ts";

describe("runs store", () => {
  it("returns null before any run", () => {
    expect(lastRunStartedAt(openDb(":memory:"))).toBeNull();
  });

  it("returns the newest start time and stores the finished run", () => {
    const db = openDb(":memory:");
    startRun(db, "schedule", "2026-10-27T07:00:00.000Z");
    const id = startRun(db, "catch-up", "2026-10-28T08:00:00.000Z");
    expect(lastRunStartedAt(db)).toBe("2026-10-28T08:00:00.000Z");
    finishRun(db, id, { counts: { published: 2 }, errors: ["x"], postponed: true, published: false, at: "2026-10-28T08:05:00.000Z" });
    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row).toMatchObject({ trigger: "catch-up", ended_at: "2026-10-28T08:05:00.000Z", postponed: 1, published: 0 });
    expect(JSON.parse(row.counts as string)).toEqual({ published: 2 });
    expect(JSON.parse(row.errors as string)).toEqual(["x"]);
  });
});
