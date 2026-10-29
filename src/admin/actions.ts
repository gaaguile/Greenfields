import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import { publish, type Deployer } from "../publish/publisher.ts";
import type { Daemon } from "../schedule/daemon.ts";
import { acquireRunLock, releaseRunLock } from "../store/runs.ts";
import type { AdminActions } from "./app.ts";

// The review page's Run now and Publish now buttons, sharing the daemon's one-run-at-a-time rule
// and the run lock that also covers a manual `npm run run-once` in another window.
export function makeAdminActions(deps: {
  daemon: Pick<Daemon, "runNow" | "exclusive">;
  db: DatabaseSync;
  cfg: AppConfig;
  deploy: Deployer;
}): AdminActions {
  return {
    runNow: () => deps.daemon.runNow(),
    async publishNow() {
      const r = await deps.daemon.exclusive(async () => {
        const lock = acquireRunLock(deps.db, process.pid, new Date().toISOString());
        if (!lock.ok) return null;
        try {
          return await publish(deps.db, deps.cfg, deps.deploy, { nowIso: new Date().toISOString() });
        } finally {
          releaseRunLock(deps.db, process.pid);
        }
      });
      if ("busy" in r || r.result === null) return { busy: true };
      return { deployed: r.result.deployed };
    },
  };
}
