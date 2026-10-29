import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { lastRunStartedAt, type RunTrigger } from "../store/runs.ts";
import { latestSlot, nextSlot } from "./slots.ts";

export interface DaemonDeps {
  db: DatabaseSync;
  cfg: AppConfig;
  // Runs the pipeline once; `slot` is the scheduled slot it belongs to, if any.
  run: (trigger: RunTrigger, slot: string | null) => Promise<void>;
  now: () => Date;
  setTimer: (ms: number, fn: () => void) => () => void;
  log: Logger;
  // A run longer than this is stuck: onHang should exit so Task Scheduler restarts the app.
  maxRunMs: number;
  onHang: () => void;
}

export interface Daemon {
  stop(): void;
  // Starts a manual run now unless one is going.
  runNow(): { started: boolean; reason?: string };
  // Runs other work (Publish now) only while no run is going, and blocks runs while it does.
  exclusive<T>(fn: () => Promise<T>): Promise<{ result: T } | { busy: true }>;
}

export function startDaemon(deps: DaemonDeps): Daemon {
  const { cfg, log } = deps;
  const { slots } = cfg.pipeline;
  let running = false;
  let cancel: (() => void) | null = null;
  let stopped = false;

  const runOnce = async (trigger: RunTrigger, slot: string | null) => {
    if (running) {
      log.warn("previous run still running; slot skipped", { trigger, slot });
      return;
    }
    running = true;
    const cancelWatchdog = deps.setTimer(deps.maxRunMs, () => {
      log.error("run took longer than the limit; restarting the app", { trigger, minutes: deps.maxRunMs / 60_000 });
      deps.onHang();
    });
    try {
      await deps.run(trigger, slot);
    } catch (err) {
      log.error("run failed", { trigger, error: (err as Error).message });
    } finally {
      cancelWatchdog();
      running = false;
    }
  };

  const schedule = () => {
    if (stopped) return;
    const next = nextSlot(deps.now(), slots, cfg.timezone);
    log.info("next run scheduled", { at: next.at.toISOString(), slot: next.slot });
    cancel = deps.setTimer(Math.max(0, next.at.getTime() - deps.now().getTime()), () => {
      void runOnce("schedule", next.slot);
      schedule();
    });
  };

  // One catch-up when the most recent slot has no run, however many slots were missed.
  const latest = latestSlot(deps.now(), slots, cfg.timezone);
  const last = lastRunStartedAt(deps.db);
  if (!last || new Date(last) < latest.at) {
    log.info("missed slot; catching up", { slot: latest.slot, lastRun: last });
    void runOnce("catch-up", latest.slot);
  }
  schedule();

  return {
    stop() {
      stopped = true;
      cancel?.();
    },
    runNow() {
      if (running) return { started: false, reason: "a run is already in progress" };
      void runOnce("manual", null);
      return { started: true };
    },
    async exclusive(fn) {
      if (running) return { busy: true };
      running = true;
      try {
        return { result: await fn() };
      } finally {
        running = false;
      }
    },
  };
}
