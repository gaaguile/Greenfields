import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeAdminActions } from "../../src/admin/actions.ts";
import { loadConfig } from "../../src/config.ts";
import type { Deployer } from "../../src/publish/publisher.ts";
import { openDb } from "../../src/store/db.ts";
import { acquireRunLock } from "../../src/store/runs.ts";

function setup() {
  const db = openDb(":memory:");
  const cfg = { ...loadConfig({}), siteOutDir: mkdtempSync(path.join(os.tmpdir(), "gf-act-")) };
  const deploys: string[] = [];
  const deploy: Deployer = async (dir) => { deploys.push(dir); };
  const daemon = {
    runNow: () => ({ started: true }),
    exclusive: async <T>(fn: () => Promise<T>) => ({ result: await fn() }),
  };
  return { db, cfg, deploys, deploy, daemon };
}

describe("makeAdminActions publishNow", () => {
  it("waits when another process holds the run lock", async () => {
    const { db, cfg, deploy, deploys, daemon } = setup();
    acquireRunLock(db, process.ppid, "2026-10-28T15:00:00.000Z");
    expect(await makeAdminActions({ daemon, db, cfg, deploy }).publishNow()).toEqual({ busy: true });
    expect(deploys).toHaveLength(0);
  });

  it("deploys and releases the lock", async () => {
    const { db, cfg, deploy, deploys, daemon } = setup();
    expect(await makeAdminActions({ daemon, db, cfg, deploy }).publishNow()).toEqual({ deployed: true });
    expect(deploys).toHaveLength(1);
    expect(acquireRunLock(db, process.ppid, "2026-10-28T15:01:00.000Z")).toEqual({ ok: true });
  });

  it("waits while the daemon is running", async () => {
    const { db, cfg, deploy, deploys } = setup();
    const busyDaemon = { runNow: () => ({ started: false }), exclusive: async () => ({ busy: true as const }) };
    expect(await makeAdminActions({ daemon: busyDaemon, db, cfg, deploy }).publishNow()).toEqual({ busy: true });
    expect(deploys).toHaveLength(0);
  });
});
