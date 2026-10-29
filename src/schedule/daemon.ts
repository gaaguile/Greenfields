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
}

export function startDaemon(deps: DaemonDeps): { stop(): void } {
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
    try {
      await deps.run(trigger, slot);
    } catch (err) {
      log.error("run failed", { trigger, error: (err as Error).message });
    } finally {
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
  };
}
