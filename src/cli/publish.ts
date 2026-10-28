import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadConfig } from "../config.ts";
import { publish, wranglerDeployer } from "../publish/publisher.ts";
import { openDb } from "../store/db.ts";

const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
try {
  const result = await publish(db, cfg, wranglerDeployer, {
    force: process.argv.includes("--force"),
    nowIso: new Date().toISOString(),
  });
  console.log(result.deployed ? "deployed" : "unchanged");
} catch (err) {
  console.error(`Publish failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
