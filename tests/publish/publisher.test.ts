import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../../src/config.ts";
import { importDataset } from "../../src/import/importDataset.ts";
import { publish, wranglerCommand, wranglerDeployer, type Deployer } from "../../src/publish/publisher.ts";
import { openDb } from "../../src/store/db.ts";
import { insertFieldValue, publishFieldValue } from "../../src/store/fieldValues.ts";
import { listProjects } from "../../src/store/projects.ts";

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../fixtures/dataset-small.json"), "utf8"));
const NOW = "2026-10-28T12:00:00.000Z";

function setup() {
  const db = openDb(":memory:");
  importDataset(db, fixture, "2026-09-01T12:00:00.000Z");
  const cfg: AppConfig = {
    ...loadConfig({}),
    dataDir: "unused", dbPath: ":memory:", siteOutDir: mkdtempSync(path.join(os.tmpdir(), "gf-pub-")),
  };
  const calls: { dir: string; projectName: string }[] = [];
  const deployer: Deployer = async (dir, projectName) => { calls.push({ dir, projectName }); };
  const storedHash = () =>
    (db.prepare("SELECT value FROM meta WHERE key = 'last_published_hash'").get() as { value: string } | undefined)?.value;
  return { db, cfg, calls, deployer, storedHash };
}

describe("publish", () => {
  it("deploys the first time and records the hash", async () => {
    const { db, cfg, calls, deployer, storedHash } = setup();
    const result = await publish(db, cfg, deployer, { nowIso: NOW });
    expect(result.deployed).toBe(true);
    expect(calls).toEqual([{ dir: cfg.siteOutDir, projectName: "greenfields" }]);
    expect(storedHash()).toBe(result.hash);
  });

  it("skips the deploy when nothing changed, unless forced", async () => {
    const { db, cfg, calls, deployer } = setup();
    await publish(db, cfg, deployer, { nowIso: NOW });
    expect((await publish(db, cfg, deployer, { nowIso: "2026-10-28T15:00:00.000Z" })).deployed).toBe(false);
    expect((await publish(db, cfg, deployer, { nowIso: NOW, force: true })).deployed).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("deploys again after a published value changes", async () => {
    const { db, cfg, calls, deployer } = setup();
    await publish(db, cfg, deployer, { nowIso: NOW });
    const viz = listProjects(db).find((p) => p.slug === "vizcachitas")!;
    const id = insertFieldValue(db, { projectId: viz.id, field: "mine_life_years", valueText: "30 years", status: "pending" });
    publishFieldValue(db, id, "auto");
    expect((await publish(db, cfg, deployer, { nowIso: NOW })).deployed).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("keeps the old hash when the deploy fails, so the next publish retries", async () => {
    const { db, cfg, calls, deployer, storedHash } = setup();
    const failing: Deployer = async () => { throw new Error("wrangler exited with code 1"); };
    await expect(publish(db, cfg, failing, { nowIso: NOW })).rejects.toThrow("wrangler exited");
    expect(storedHash()).toBeUndefined();
    expect((await publish(db, cfg, deployer, { nowIso: NOW })).deployed).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("wranglerCommand", () => {
  it("runs wrangler through node without a shell, keeping paths with spaces as one argument", () => {
    const { command, args } = wranglerCommand("C:\\Users\\John Smith\\site", "greenfields");
    expect(command).toBe(process.execPath);
    expect(args[0]).toMatch(/wrangler[\\/]bin[\\/]wrangler\.js$/);
    expect(args.slice(1, 4)).toEqual(["pages", "deploy", "C:\\Users\\John Smith\\site"]);
    expect(args).toContain("greenfields");
  });
});

describe("wranglerDeployer", () => {
  it("refuses to run without CLOUDFLARE_API_TOKEN", async () => {
    const saved = { token: process.env.CLOUDFLARE_API_TOKEN, account: process.env.CLOUDFLARE_ACCOUNT_ID };
    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_ACCOUNT_ID = "abc";
    try {
      await expect(wranglerDeployer("dist/site", "greenfields")).rejects.toThrow("CLOUDFLARE_API_TOKEN");
    } finally {
      if (saved.token !== undefined) process.env.CLOUDFLARE_API_TOKEN = saved.token;
      if (saved.account !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = saved.account;
      else delete process.env.CLOUDFLARE_ACCOUNT_ID;
    }
  });
});
