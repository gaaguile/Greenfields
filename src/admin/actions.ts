import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import type { Logger } from "../log.ts";
import { publish, type Deployer } from "../publish/publisher.ts";
import type { Daemon } from "../schedule/daemon.ts";
import { acquireRunLock, releaseRunLock } from "../store/runs.ts";
import type { AdminActions } from "./app.ts";

export interface PublishOutcome {
  at: string;
  outcome: "deployed" | "unchanged" | "failed" | "busy";
  error?: string;
}

const LAST_PUBLISH_KEY = "last_publish";

export function lastPublish(db: DatabaseSync): PublishOutcome | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(LAST_PUBLISH_KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as PublishOutcome) : null;
}

function recordPublish(db: DatabaseSync, o: PublishOutcome): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    LAST_PUBLISH_KEY, JSON.stringify(o),
  );
}

// The review page's Run now and Publish now buttons. They share the daemon's one-thing-at-a-time rule and the run
// lock that also covers a manual `npm run run-once` in another window. A deploy can take minutes, longer than
// Cloudflare waits for a page, so Publish now runs in the background and the Health tab shows how it went.
export function makeAdminActions(deps: {
  daemon: Pick<Daemon, "runNow" | "exclusive" | "busy">;
  db: DatabaseSync;
  cfg: AppConfig;
  deploy: Deployer;
  log: Logger;
  now: () => Date;
}): AdminActions {
  const { db, log } = deps;
  const at = () => deps.now().toISOString();
  const publishLocked = async (): Promise<PublishOutcome> => {
    if (!acquireRunLock(db, process.pid, at()).ok) return { at: at(), outcome: "busy" };
    try {
      const r = await publish(db, deps.cfg, deps.deploy, { nowIso: at() });
      return { at: at(), outcome: r.deployed ? "deployed" : "unchanged" };
    } catch (err) {
      const error = (err as Error).message;
      log.error("Publish now failed", { error });
      return { at: at(), outcome: "failed", error };
    } finally {
      releaseRunLock(db, process.pid);
    }
  };
  return {
    runNow: () => deps.daemon.runNow(),
    publishNow() {
      if (deps.daemon.busy()) return { busy: true };
      void deps.daemon
        .exclusive(publishLocked)
        .then((r) => recordPublish(db, "busy" in r ? { at: at(), outcome: "busy" } : r.result))
        .catch((err) => log.error("Publish now failed", { error: (err as Error).message }));
      return { started: true };
    },
  };
}
