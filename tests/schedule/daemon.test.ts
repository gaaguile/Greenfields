import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import type { Logger } from "../../src/log.ts";
import { startDaemon } from "../../src/schedule/daemon.ts";
import { openDb } from "../../src/store/db.ts";
import { startRun, type RunTrigger } from "../../src/store/runs.ts";

const lines: string[] = [];
const log: Logger = { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };

function harness(nowIso: string, run?: (trigger: RunTrigger) => Promise<void>) {
  const db = openDb(":memory:");
  let now = new Date(nowIso);
  const timers: { ms: number; fn: () => void }[] = [];
  const runs: { trigger: RunTrigger; slot: string | null }[] = [];
  const daemon = () =>
    startDaemon({
      db,
      cfg: loadConfig({}),
      run: async (trigger, slot) => {
        runs.push({ trigger, slot });
        if (run) await run(trigger);
      },
      now: () => now,
      setTimer: (ms, fn) => { timers.push({ ms, fn }); return () => {}; },
      log,
    });
  // Moves the clock to the timer's due time and fires it.
  const fireNext = async () => {
    const t = timers.shift()!;
    now = new Date(now.getTime() + t.ms);
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { db, daemon, timers, runs, fireNext, setNow: (iso: string) => { now = new Date(iso); } };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("startDaemon", () => {
  it("runs one catch-up at startup when no run exists", async () => {
    const h = harness("2026-10-28T15:00:00Z");
    h.daemon();
    await settle();
    expect(h.runs).toEqual([{ trigger: "catch-up", slot: "10:00" }]);
  });

  it("does not catch up when the latest slot already has a run", async () => {
    const h = harness("2026-10-28T15:00:00Z");
    startRun(h.db, "schedule", "2026-10-28T14:00:05.000Z");
    h.daemon();
    await settle();
    expect(h.runs).toEqual([]);
  });

  it("fires the next slot with trigger schedule and sets the following timer", async () => {
    const h = harness("2026-10-28T15:00:00Z");
    startRun(h.db, "schedule", "2026-10-28T14:00:05.000Z");
    h.daemon();
    expect(h.timers[0].ms).toBe(new Date("2026-10-29T07:00:00Z").getTime() - new Date("2026-10-28T15:00:00Z").getTime());
    await h.fireNext();
    expect(h.runs).toEqual([{ trigger: "schedule", slot: "03:00" }]);
    expect(h.timers[0].ms).toBe(7 * 3600_000);
  });

  it("logs a run that throws and still sets the next timer", async () => {
    const h = harness("2026-10-28T15:00:00Z", async () => { throw new Error("boom"); });
    startRun(h.db, "schedule", "2026-10-28T14:00:05.000Z");
    h.daemon();
    await h.fireNext();
    expect(lines.some((l) => l.includes("run failed"))).toBe(true);
    expect(h.timers).toHaveLength(1);
  });

  it("skips a slot that arrives while a run is still going", async () => {
    let release!: () => void;
    const h = harness("2026-10-28T15:00:00Z", () => new Promise<void>((r) => { release = r; }));
    h.daemon(); // starts a catch-up that does not finish
    await settle();
    await h.fireNext();
    expect(h.runs.map((r) => r.trigger)).toEqual(["catch-up"]);
    expect(lines.some((l) => l.includes("still running"))).toBe(true);
    release();
  });
});
