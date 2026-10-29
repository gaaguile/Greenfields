import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lastPublish, makeAdminActions } from "../../src/admin/actions.ts";
import { loadConfig } from "../../src/config.ts";
import type { Logger } from "../../src/log.ts";
import type { Deployer } from "../../src/publish/publisher.ts";
import { openDb } from "../../src/store/db.ts";
import { acquireRunLock } from "../../src/store/runs.ts";

const settle = () => new Promise((r) => setTimeout(r, 50));

// The publish runs in the background (it builds the site), so wait for its recorded outcome.
async function outcomeOf(db: Parameters<typeof lastPublish>[0]) {
  for (let i = 0; i < 200 && !lastPublish(db); i++) await settle();
  return lastPublish(db);
}

function setup(deploy?: Deployer, daemonBusy = false) {
  const db = openDb(":memory:");
  const cfg = { ...loadConfig({}), siteOutDir: mkdtempSync(path.join(os.tmpdir(), "gf-act-")) };
  const deploys: string[] = [];
  const errors: string[] = [];
  const log: Logger = { info: () => {}, warn: () => {}, error: (m, d) => errors.push(`${m} ${JSON.stringify(d)}`) };
  const daemon = {
    runNow: () => ({ started: true }),
    busy: () => daemonBusy,
    exclusive: async <T>(fn: () => Promise<T>) => ({ result: await fn() }),
  };
  const actions = makeAdminActions({
    daemon, db, cfg, log, now: () => new Date("2026-10-28T15:00:00.000Z"),
    deploy: deploy ?? (async (dir) => { deploys.push(dir); }),
  });
  return { db, deploys, errors, actions };
}

describe("makeAdminActions publishNow", () => {
  it("publishes in the background and records the outcome", async () => {
    const { db, deploys, actions } = setup();
    expect(actions.publishNow()).toEqual({ started: true });
    expect(await outcomeOf(db)).toEqual({ at: "2026-10-28T15:00:00.000Z", outcome: "deployed" });
    expect(acquireRunLock(db, process.ppid, "2026-10-28T15:01:00.000Z")).toEqual({ ok: true });
  });

  it("records and logs a failed deploy", async () => {
    const { db, errors, actions } = setup(async () => { throw new Error("wrangler exited with code 1: no token"); });
    actions.publishNow();
    expect(await outcomeOf(db)).toMatchObject({ outcome: "failed", error: "wrangler exited with code 1: no token" });
    expect(errors.join()).toContain("wrangler exited with code 1");
  });

  it("records that another process holds the run lock", async () => {
    const { db, deploys, actions } = setup();
    acquireRunLock(db, process.ppid, "2026-10-28T14:59:00.000Z");
    actions.publishNow();
    expect(await outcomeOf(db)).toMatchObject({ outcome: "busy" });
    expect(deploys).toHaveLength(0);
  });

  it("says busy at once while the daemon is running", () => {
    const { deploys, actions } = setup(undefined, true);
    expect(actions.publishNow()).toEqual({ busy: true });
    expect(deploys).toHaveLength(0);
  });
});
